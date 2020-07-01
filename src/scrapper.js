require('dotenv').config();
const Sentry = require('@sentry/node');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const interval = require('interval-promise');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const { winston } = require('./lib/util');
const { Mention } = require('./models/Mention');
const { Merit } = require('./models/Merit');
const { Post } = require('./models/Post');
const { Modlog } = require('./schemas/Modlog');

const logger = winston.loggers.get('logs');
iconv.skipDecodeWarning = true;
dayjs.extend(utc);

Sentry.init({
  dsn: process.env.NODE_ENV === 'development' ? null : process.env.SENTRY_DSN,
});

async function fetchPosts() {
  const url = 'https://bitcointalk.org/index.php?action=recent';

  const result = await axios.get(url, {
    responseType: 'arraybuffer',
    responseEncoding: 'binary',
  });

  return cheerio.load(
    iconv.decode(result.data.toString('binary'), 'ISO-8859-1'),
    {
      decodeEntities: false,
    }
  );
}

// function that parses the html and takes the posts from btt's recent page
async function scrapePosts() {
  try {
    const $ = await fetchPosts();
    const forumDateRaw = $('span.smalltext').html();
    const todayDate = forumDateRaw.replace(/\d\d:.*/g, '').trim();

    $($('div#bodyarea table[cellpadding="4"] > tbody').get().reverse()).each(
      async (i, e) => {
        const title = $(e)
          .find('td.middletext > div:nth-child(2)')
          .text()
          .trim();
        const dateText = $(e)
          .find('td.middletext > div:nth-child(3)')
          .text()
          .replace('on: Today at', todayDate)
          .trim();
        const date = dayjs(new Date(dateText)).format('YYYY-MM-DDTHH:mm:ss');
        const author = $(e)
          .find('td.catbg > span.middletext')
          .text()
          .replace(/^.*Last post by /g, '')
          .trim();
        const authorUID = Number(
          $(e)
            .find('tr:nth-child(2) > td > span > a:nth-child(2)')
            .attr('href')
            .replace('https://bitcointalk.org/index.php?action=profile;u=', '')
        );
        const contentFull = $(e).find('td.windowbg2 > div.post').html();
        const link = $(e)
          .find('td.middletext > div:nth-child(2) > b > a')
          .attr('href');
        const id = link.replace(/^.*#msg/g, '');

        const exists = await Post.findByPk(id);

        if (!exists) {
          try {
            await Post.create({
              id,
              title,
              date,
              author,
              author_uid: authorUID,
              content_full: contentFull,
              link,
            });
          } catch (error) {
            logger.error(`Error inserting post ${id}: ${error}`, {
              metadata: { type: 'error', process: 'scrapper', post_id: id },
            });
          }
        }
      }
    );
  } catch (error) {
    if (error.code) {
      logger.error(`Error: ${error.code} ${error.config.url}`, {
        metadata: {
          type: 'error',
          process: 'scrapper',
          error_code: error.code,
        },
      });
      if (error.code === 'EAI_AGAIN') {
        process.exit(1);
      }
    } else {
      logger.error(`Error: ${error}`, {
        metadata: { type: 'error', process: 'scrapper' },
      });
    }
  }
}

async function newFetchMerits() {
  const response = await axios.get(
    'https://bitcointalk.org/index.php?action=merit;stats=recent',
    {
      headers: {
        Cookie: process.env.BITCOINTALK_COOKIE,
      },
      responseType: 'arraybuffer',
      responseEncoding: 'binary',
    }
  );

  return cheerio.load(
    iconv.decode(response.data.toString('binary'), 'ISO-8859-1'),
    {
      decodeEntities: false,
    }
  );
}

async function fetchModlog() {
  const response = await axios.get('https://bitcointalk.org/modlog.php', {
    responseType: 'arraybuffer',
    responseEncoding: 'binary',
  });

  return cheerio.load(
    iconv.decode(response.data.toString('binary'), 'ISO-8859-1'),
    {
      decodeEntities: false,
    }
  );
}

async function scrapeModlogTopicRemovals() {
  const $ = await fetchModlog();

  $('#helpmain > ul > li').each(async (i, e) => {
    if (i >= 100) return;
    if (!$(e).text().startsWith('Remove topic:')) return;

    const topicLink = $(e).find('a:nth-child(2)').attr('href');
    const topicId = Number(topicLink.replace(/.*\?topic=|\.0/g, ''));
    const topicTitle = $(e).find('i').text();

    const exists = await Modlog.findOne({ id: topicId });
    if (exists) return;

    await Modlog.create({ type: 1, title: topicTitle, id: topicId });
  });
}

async function fetchPost(url) {
  const response = await axios.get(url, {
    headers: {
      Cookie: process.env.BITCOINTALK_COOKIE,
    },
    responseType: 'arraybuffer',
    responseEncoding: 'binary',
  });

  return cheerio.load(
    iconv.decode(response.data.toString('binary'), 'ISO-8859-1'),
    {
      decodeEntities: false,
    }
  );
}

async function scrapePost(url) {
  const $ = await fetchPost(url);

  const postsTable = $('#quickModForm > table.bordercolor');
  let post = {};

  const forumDateRaw = $('span.smalltext').html();
  const todayDate = forumDateRaw.replace(/\d\d:.*/g, '').trim();

  $(postsTable)
    .find('tbody > tr > td > table > tbody > tr > td > table > tbody > tr')
    .each(async (i, e) => {
      const postHeader = $(e).find(
        "td.td_headerandpost td > div[id*='subject'] > a"
      );
      if (postHeader && postHeader.attr('href')) {
        if ($(postHeader).attr('href') === url) {
          const receiver = $(e).find('td.poster_info > b > a');

          const postTitle = postHeader.text().trim();
          const receiverUsername = receiver.html();
          const receiverLink = receiver.attr('href');
          const receiverUID = receiverLink.replace(
            'https://bitcointalk.org/index.php?action=profile;u=',
            ''
          );

          const titleBoard = $('#bodyarea > div > div > b').parent();

          const boards = $(titleBoard).find('b');
          const boardsArray = [];
          let fullBoardTitle = '';

          $(boards).each((boardIndex, board) => {
            const { length } = boards;
            const boardName = $(board).text();

            if (boardIndex < length - 1 && boardIndex !== 0) {
              boardsArray.push(boardName);
              fullBoardTitle += `${boardName}`;
              if (boardIndex < length - 2) {
                fullBoardTitle += ` / `;
              }
            }
          });

          const fullBoardTitleAndPost = `${fullBoardTitle} / ${postTitle}`;

          const content = $(e).find('td.td_headerandpost div.post').html();
          const date = $(e)
            .find('td.td_headerandpost table div:nth-child(2)')
            .text()
            .replace('Today at', todayDate)
            .replace(/Last edit:.*/, '');

          const dateFormat = dayjs(new Date(date)).format(
            'YYYY-MM-DDTHH:mm:ss'
          );
          const id = url.match(/#msg(.*)/gi)[0].replace(/#msg/gi, '');

          post = {
            id: Number(id),
            title: fullBoardTitleAndPost,
            date: dateFormat,
            author: receiverUsername,
            content_full: content,
            link: url,
            author_uid: Number(receiverUID),
          };
        }
      }
    });

  return post;
}

async function scrapeMerits() {
  const $ = await newFetchMerits();

  const forumDateRaw = $('span.smalltext').html();
  const todayDate = forumDateRaw.replace(/\d\d:.*/g, '').trim();

  $('ul > li').each(async (i, e) => {
    if (i >= 30) return;
    const meritsRaw = $(e).html();
    const withFixedDate = meritsRaw.replace('<b>Today</b> at', todayDate);

    const date = withFixedDate.replace(/: \d+ from.*/gi, '');
    const dateParsed = dayjs(date).format('YYYY-MM-DDTHH:mm:ss');

    const sender = withFixedDate
      .match(/">(.*)<\/a> for/gi)[0]
      .replace(/">|<\/.*/gi, '');

    const senderLink = $(e)
      .find('a:nth-child(2)')
      .attr('href')
      .replace('https://bitcointalk.org', '');

    const amount = Number(
      withFixedDate
        .match(/: (.*)from/gi)[0]
        .replace(/:| from.*/gi, '')
        .trim()
    );

    const postId = withFixedDate
      .match(/#msg(.*)">/gi)[0]
      .replace(/#msg|">/gi, '');

    const postLink = withFixedDate
      .match(/for <a href="\/index\.php\?.+\d">/gi)[0]
      .replace(/.*="|">.*/gi, '');

    const post = await Post.findByPk(postId, {
      attributes: ['title', 'link', 'author', 'author_uid'],
      raw: true,
    });

    const merit = {
      date: dateParsed,
      amount,
      sender,
      post: post || Number(postId),
      postLink,
    };

    const timeAgo = dayjs(new Date(dayjs.utc().format('YYYY-MM-DDTHH:mm:ss')))
      .subtract(30, 'minute')
      .format('YYYY-MM-DDTHH:mm:ss');

    if (dateParsed > timeAgo) {
      if (merit.post) {
        if (
          merit.post.title &&
          merit.post.title !== '~Unknown Title~' &&
          merit.post.author_uid
        ) {
          const userSubbed = await Mention.findOne({
            where: { uid: merit.post.author_uid },
          });

          if (userSubbed) {
            const exists = await Merit.findOne({
              where: {
                datetime: merit.date,
                amount,
                post_link: postLink,
              },
            });

            if (!exists) {
              await Merit.create({
                datetime: merit.date,
                amount,
                sender_username: sender,
                sender_link: senderLink,
                post_title: post.title,
                post_link: postLink,
                receiver_uid: merit.post.author_uid,
              });
            }
          }
        }

        if (
          !merit.post.title ||
          merit.post.title === '~Unknown Title~' ||
          !merit.post.author_uid
        ) {
          setTimeout(async () => {
            const scrappedPost = await scrapePost(
              `https://bitcointalk.org${postLink}`
            );

            const exists = await Post.findByPk(scrappedPost.id);

            if (exists) {
              exists.title = scrappedPost.title;
              exists.author_uid = scrappedPost.author_uid;
              await exists.save();
            } else {
              await Post.create(scrappedPost);
            }
          }, 1000 * i);
        }
      }
    }
  });
}

(async () => {
  logger.info('Starting scrapper', {
    metadata: { type: 'start', process: 'scrapper' },
  });

  scrapePosts().then(() => {
    interval(async () => {
      await scrapePosts();
    }, 4000);
  });

  interval(async () => {
    await scrapeMerits();
  }, 5000);

  interval(async () => {
    await scrapeModlogTopicRemovals();
  }, 60000);
})();
