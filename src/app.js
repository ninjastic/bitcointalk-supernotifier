require('dotenv').config();
const Sentry = require('@sentry/node');
const iconv = require('iconv-lite');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const cheerio = require('cheerio');
const interval = require('interval-promise');
const ethereumRegex = require('ethereum-regex');
const { Sequelize, Op } = require('sequelize');
const { timeout, winston } = require('./lib/util');
const { Bot } = require('./telegram.js');
const { Post } = require('./models/Post');
const { Mention } = require('./models/Mention');
const { Topic } = require('./models/Topic');
const { Merit } = require('./models/Merit');
const { Ignore } = require('./models/Ignore');
const { Modlog } = require('./schemas/Modlog');
const { Address } = require('./schemas/Address');

const logger = winston.loggers.get('logs');
iconv.skipDecodeWarning = true;
dayjs.extend(utc);

Sentry.init({
  dsn: process.env.NODE_ENV === 'development' ? null : process.env.SENTRY_DSN,
});

async function pullData() {
  const mentions = await Mention.findAll({
    where: { [Op.or]: [{ enable_mentions: true }, { enable_merits: true }] },
  });
  const posts = await Post.findAll({
    limit: 20,
    order: [['id', 'DESC']],
    where: {
      created_at: {
        [Op.gte]: dayjs.utc().subtract(30, 'minute').toISOString(),
      },
    },
  });
  const ignore = await Ignore.findAll();
  const topicsAll = await Topic.findAll();
  const topics = topicsAll.filter((topic) => topic.tracking.length);
  return { mentions, posts, topics, ignore };
}

async function checkForAddresses({ posts }) {
  Promise.all(
    posts.map(async (post) => {
      const $ = cheerio.load(post.content_full);
      const data = $('body');
      data.children('div.quoteheader').remove();
      data.children('div.quote').remove();
      data.find('br').replaceWith('&nbsp;');
      const content = data.text().replace(/\s\s+/g, ' ').trim();
      const post_url = post.link.replace(
        /https:\/\/bitcointalk\.org\/index\.php\?topic=/g,
        ''
      );

      const ethAddresses = content.match(ethereumRegex());

      if (ethAddresses) {
        Promise.all(
          ethAddresses.map(async (address) => {
            const addressExists = await Address.findOne({
              coin: 'ETH',
              address,
              'mentions.author': post.author,
              'mentions.author_uid': post.author_uid,
              'mentions.post_url': post_url,
            });

            if (!addressExists) {
              await Address.findOneAndUpdate(
                {
                  coin: 'ETH',
                  address,
                },
                {
                  $push: {
                    mentions: {
                      author: post.author,
                      author_uid: post.author_uid,
                      post_url,
                    },
                  },
                },
                { upsert: true }
              );
            }
          })
        );
      }
    })
  );
}

async function checkForMentions(bot, { mentions, posts, ignore }) {
  posts.forEach((post) => {
    mentions.forEach(async (mention) => {
      if (post.author.toLowerCase() !== mention.username.toLowerCase()) {
        const usernameMatch = new RegExp(`\\b${mention.username}\\b`, 'gi');
        const altMatch = mention.alt_username
          ? new RegExp(`\\b${mention.alt_username}\\b`, 'gi')
          : null;
        if (
          post.content_full.match(usernameMatch) ||
          (altMatch && post.content_full.match(altMatch))
        ) {
          const hasIgnored = ignore.filter(
            (i) =>
              i.ignoring.includes(mention.chat_id) &&
              (i.link ===
                post.link
                  .replace('/topic ', '')
                  .replace(/#.*/g, '')
                  .replace(/.msg.*/g, '')
                  .replace(/\.0/g, '')
                  .trim() ||
                i.username === post.author)
          );
          if (!post.mentioned.includes(mention.chat_id)) {
            if (mention.enable_mentions && !hasIgnored.length)
              await bot.sendMention(mention, post);
            await Post.update(
              {
                mentioned: Sequelize.fn(
                  'array_append',
                  Sequelize.col('mentioned'),
                  mention.chat_id
                ),
              },
              { where: { id: post.id } }
            );
          }
        }
      }
    });
  });
}

async function checkForRepliesInTrackedPost(bot, { posts, topics }) {
  posts.forEach((post) => {
    const postTopic = parseInt(post.link.replace(/^.*topic=|\..*/gi, ''), 10);
    topics.forEach((topic) => {
      if (postTopic === topic.id) {
        topic.tracking.forEach(async (chat_id) => {
          if (!post.tracked.includes(chat_id)) {
            const updatedPost = await Post.findByPk(post.id);
            if (!updatedPost.mentioned.includes(chat_id)) {
              const mention = await Mention.findOne({ where: { chat_id } });
              await bot.sendReplyInTrackedPost(post, topic, mention, chat_id);
            }
          }
        });
      }
    });
  });
}

async function checkForNewMerits(bot, { mentions, merits }) {
  return mentions.forEach((mention) => {
    merits.forEach(async (merit) => {
      if (mention.uid === merit.receiver_uid && !merit.notified) {
        const updatedMerit = await Merit.findByPk(merit.id);
        if (updatedMerit.notified === true) {
          return;
        }

        updatedMerit.notified = true;
        await updatedMerit.save();

        if (mention.enable_merits)
          await bot.sendMeritNotification(mention, merit);
      }
    });
  });
}

async function checkDeletions(bot) {
  const modlogs = await Modlog.find({ notified: false });

  for (let x = 0; x < modlogs.length; x += 1) {
    const posts = await Post.findAll({
      where: {
        link: {
          [Op.like]: `https://bitcointalk.org/index.php?topic=${modlogs[x].id}.msg%`,
        },
      },
    });

    await Modlog.findOneAndUpdate(
      { id: modlogs[x].id, notified: false },
      { notified: true }
    );

    const postsToNotify = [];

    await Promise.all(
      posts.map(async (post) => {
        const userExists = await Mention.findOne({
          where: { uid: post.author_uid, notify_deleted: true },
        });

        if (!userExists) return;

        postsToNotify[userExists.id] = {
          user: userExists.dataValues,
          posts: postsToNotify[userExists.id]
            ? [...postsToNotify[userExists.id].posts, post.dataValues]
            : [post.dataValues],
        };
      })
    );

    await Promise.all(
      postsToNotify.map(async (u) => {
        if (u.posts.length === 1) {
          return bot.sendReplyDeleted(u.posts[0], modlogs[x], u.user);
        }

        return bot.sendReplyMultipleDeleted(u.posts.length, modlogs[x], u.user);
      })
    );
  }
}

(async () => {
  logger.info('Starting bot', {
    metadata: { type: 'start', process: 'app' },
  });
  const bot = new Bot();

  async function postThings() {
    const data = await pullData();
    await checkForMentions(bot, data);
    await checkForAddresses(data);
    await timeout(3000);
    await checkForRepliesInTrackedPost(bot, data);
  }

  async function meritThings() {
    const mentions = await Mention.findAll({
      where: { uid: { [Op.ne]: null } },
    });

    const merits = await Merit.findAll({
      where: {
        notified: false,
        datetime: {
          [Op.gte]: dayjs.utc().subtract(20, 'minute').toISOString(),
        },
      },
    });

    await checkForNewMerits(bot, { mentions, merits });
  }

  interval(async () => {
    await postThings();
  }, 2500);

  interval(async () => {
    await meritThings();
  }, 5000);

  interval(async () => {
    await checkDeletions(bot);
  }, 3000);
})();
