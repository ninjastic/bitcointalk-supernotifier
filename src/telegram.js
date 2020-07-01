require('dotenv').config();
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { Telegraf } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const TelegrafI18n = require('telegraf-i18n');
const { pluralize } = require('telegraf-i18n');
const { match } = require('telegraf-i18n');
const Keyboard = require('telegraf-keyboard');
const rateLimit = require('telegraf-ratelimit');
const { Op, Sequelize } = require('sequelize');
const { winston } = require('./lib/util');
const { Post } = require('./models/Post');
const { Mention } = require('./models/Mention');
const { Topic } = require('./models/Topic');
const { Ignore } = require('./models/Ignore');

class Bot {
  constructor() {
    this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    this.bot.launch();
    this.logger = winston.loggers.get('logs');

    this.session = new LocalSession({
      database: './src/sessions.json',
      storage: LocalSession.storageFileAsync,
    });

    this.bot.use(this.session.middleware());

    this.keyboard = null;

    this.i18n = new TelegrafI18n({
      useSession: true,
      defaultLanguage: 'en',
      defaultLanguageOnMissing: true,
      directory: path.resolve(__dirname, 'locales'),
      templateData: {
        pluralize,
      },
    });

    this.bot.use(this.i18n.middleware());

    this.bot.use(async (ctx, next) => {
      if (!ctx.session.language) {
        const mention = await Mention.findOne({
          where: { chat_id: ctx.chat.id },
        });

        ctx.session.language = mention ? mention.language : 'en';
        ctx.session.userChooseLanguage = Boolean(mention);
      }

      ctx.i18n.locale(ctx.session.language);
      next();
    });

    const limitConfig = {
      window: 1000,
      limit: 2,
      onLimitExceeded: (ctx) => ctx.reply(ctx.i18n.t('too_fast')),
    };

    this.bot.use(rateLimit(limitConfig));

    this.bot.command('/topic', (ctx) => {
      this.addTopic(ctx);
    });

    this.bot.hears(/\/?menu/gi, (ctx) => {
      this.showMenuKeyboard(ctx);
    });

    this.bot.command('/alt', (ctx) => {
      this.setAltUsername(ctx);
    });

    this.bot.hears([match('show_ignore'), /\/?ignore/gi], (ctx) => {
      this.handleIgnoreList(ctx);
    });

    this.bot.hears([match('show_topics'), /\/?topics/gi], (ctx) => {
      this.viewTopics(ctx);
    });

    this.bot.hears(
      [match('show_commands'), /\/?commands?|\/?help?/gi],
      (ctx) => {
        let message = `<b>${ctx.i18n.t('commands_title')}</b>\n\n`;
        message += `<code>/menu</code>  - ${ctx.i18n.t('commands_menu')}\n`;
        message += `<code>/start</code>  - ${ctx.i18n.t('commands_start')}\n`;
        message += `<code>/topic (url)</code>  - ${ctx.i18n.t(
          'commands_topic'
        )}\n`;
        message += `<code>/topics</code> - ${ctx.i18n.t('commands_topics')}\n`;
        message += `<code>/alt (name)</code>  - ${ctx.i18n.t(
          'commands_alt'
        )}\n`;
        message += `<code>/ignore</code> - ${ctx.i18n.t('commands_ignore')}\n`;
        message += `<code>/ignore (url/username)</code> - ${ctx.i18n.t(
          'commands_ignore_input'
        )}\n`;
        ctx.replyWithHTML(message);
      }
    );

    this.bot.hears(match('notifications'), (ctx) => {
      this.showMenuKeyboard(ctx, null, 'notifications');
    });

    this.bot.hears(match('back'), (ctx) => {
      this.showMenuKeyboard(ctx, null, 'initial');
    });

    // trigger to enable mentions
    this.bot.hears(
      [match('enable_mentions'), /enable mentions/gi],
      async (ctx) => {
        await this.setEnableMentions(ctx.chat.id, true);
        this.showMenuKeyboard(
          ctx,
          ctx.i18n.t('mentions_enabled', 'notifications'),
          'notifications'
        );
      }
    );

    // trigger to disable mentions
    this.bot.hears(
      [match('disable_mentions'), /disable mentions/gi],
      async (ctx) => {
        await this.setEnableMentions(ctx.chat.id, false);
        this.showMenuKeyboard(
          ctx,
          ctx.i18n.t('mentions_disabled', 'notifications'),
          'notifications'
        );
      }
    );

    // trigger to enable merits
    this.bot.hears([match('enable_merits'), /enable merits/gi], async (ctx) => {
      await this.setEnableMerits(ctx.chat.id, true);
      this.showMenuKeyboard(ctx, ctx.i18n.t('merits_enabled'), 'notifications');
    });

    // trigger to disable merits
    this.bot.hears(
      [match('disable_merits'), /disable merits/gi],
      async (ctx) => {
        await this.setEnableMerits(ctx.chat.id, false);
        this.showMenuKeyboard(
          ctx,
          ctx.i18n.t('merits_disabled'),
          'notifications'
        );
      }
    );

    // trigger to enable deleted posts
    this.bot.hears(
      ['✅ Enable Deleted Posts', /enable deleted/gi],
      async (ctx) => {
        await this.setEnableDeletedPosts(ctx.chat.id, true);
        await this.showMenuKeyboard(
          ctx,
          'Deleted posts enabled',
          'notifications'
        );
      }
    );

    // trigger to disable deleted posts
    this.bot.hears(
      ['❌ Disable Deleted Posts', /disable deleted/gi],
      async (ctx) => {
        await this.setEnableDeletedPosts(ctx.chat.id, false);
        await this.showMenuKeyboard(
          ctx,
          'Deleted posts disabled',
          'notifications'
        );
      }
    );

    // trigger to change language
    this.bot.hears(
      [match('change_language'), /change language|\/?language/gi],
      async (ctx) => {
        this.changeLanguage(ctx);
      }
    );

    const startCommand = async (ctx) => {
      if (!ctx.session.userChooseLanguage) {
        await this.changeLanguage(ctx);
      } else {
        await ctx.reply(ctx.i18n.t('welcome'), {
          reply_markup: JSON.stringify({
            remove_keyboard: true,
          }),
        });
        await ctx.reply(ctx.i18n.t('ask_username'));
        ctx.session.waitingForUsername = true;
        ctx.session.waitingForUid = false;
      }
    };

    this.bot.start(async (ctx) => {
      startCommand(ctx);
    });

    const confirmUsernameInput = (ctx) => {
      ctx.replyWithHTML(
        ctx.i18n.t('confirm_username', { username: ctx.message.text }),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: ctx.i18n.t('option_yes'),
                  callback_data: JSON.stringify({
                    type: 'confirm_username',
                    value: ctx.message.text,
                  }),
                },
                {
                  text: ctx.i18n.t('option_no'),
                  callback_data: JSON.stringify({
                    type: 'confirm_username',
                    value: null,
                  }),
                },
              ],
            ],
          },
        }
      );
    };

    const confirmUidInput = (ctx) => {
      ctx.replyWithHTML(ctx.i18n.t('confirm_uid', { uid: ctx.message.text }), {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: ctx.i18n.t('option_yes'),
                callback_data: JSON.stringify({
                  type: 'confirm_uid',
                  value: ctx.message.text,
                }),
              },
              {
                text: ctx.i18n.t('option_no'),
                callback_data: JSON.stringify({
                  type: 'confirm_uid',
                  value: null,
                }),
              },
            ],
          ],
        },
      });
    };

    const askForMentions = (ctx) => {
      ctx.reply(ctx.i18n.t('ask_for_mentions'), {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: ctx.i18n.t('option_yes'),
                callback_data: JSON.stringify({
                  type: 'confirm_mentions',
                  value: true,
                }),
              },
              {
                text: ctx.i18n.t('option_no'),
                callback_data: JSON.stringify({
                  type: 'confirm_mentions',
                  value: false,
                }),
              },
            ],
          ],
        },
      });
    };

    const askForMerits = async (ctx) => {
      await ctx.reply(ctx.i18n.t('ask_for_merits'), {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: ctx.i18n.t('option_yes'),
                callback_data: JSON.stringify({
                  type: 'confirm_merits',
                  value: true,
                }),
              },
              {
                text: ctx.i18n.t('option_no'),
                callback_data: JSON.stringify({
                  type: 'confirm_merits',
                  value: false,
                }),
              },
            ],
          ],
        },
      });
    };

    this.bot.on('message', async (ctx) => {
      if (ctx.session.waitingForUsername) {
        confirmUsernameInput(ctx);
        return;
      }

      if (ctx.session.waitingForUid) {
        confirmUidInput(ctx);
        return;
      }

      if (!ctx.session.userChooseLanguage) {
        await ctx.reply(
          `${ctx.i18n.t('help_stuck')}\n\n${ctx.i18n.t('help_stuck2')}`
        );
        return;
      }

      this.showMenuKeyboard(ctx, ctx.i18n.t('help_stuck'));
    });

    const askUid = async (ctx) => {
      ctx.session.waitingForUid = true;
      ctx.session.waitingForUsername = false;

      await ctx.reply(ctx.i18n.t('ask_uid'), {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: ctx.i18n.t('dont_know'),
                callback_data: JSON.stringify({
                  type: 'help_uid',
                  value: true,
                }),
              },
            ],
          ],
        },
      });
    };

    this.bot.on('callback_query', async (ctx) => {
      const query = ctx.update.callback_query;
      const data = JSON.parse(query.data);

      if (data.type === 'confirm_username') {
        if (data.value) {
          ctx.session.waitingForUid = true;
          ctx.session.waitingForUsername = false;
          this.session.saveSession(
            this.session.getSessionKey(ctx),
            ctx.session
          );
          await ctx.answerCbQuery();
          await ctx.deleteMessage(query.message.message_id);
          await this.setUsername(query.from.id, data.value);
          await this.setLanguage(query.from.id, ctx.session.language);
          askUid(ctx);
          return;
        }
        await ctx.answerCbQuery();
        await ctx.deleteMessage(query.message.message_id);
        await ctx.reply(ctx.i18n.t('ask_username_again'));
        ctx.session.waitingForUsername = true;
      }

      if (data.type === 'confirm_mentions') {
        if (data.value) {
          await this.setEnableMentions(query.from.id, data.value);
          await ctx.answerCbQuery();
          await ctx.editMessageText(`${ctx.i18n.t('ask_for_mentions_yes')}`);
          await askForMerits(ctx);
          return;
        }
        await this.setEnableMentions(query.from.id, data.value);
        await ctx.answerCbQuery();
        await ctx.editMessageText(`${ctx.i18n.t('ask_for_mentions_no')}`);
        await askForMerits(ctx);
      }

      if (data.type === 'confirm_merits') {
        if (data.value) {
          await this.setEnableMerits(query.from.id, data.value);
          ctx.answerCbQuery();
          ctx.editMessageText(`${ctx.i18n.t('ask_for_merits_yes')}`);
          this.showMenuKeyboard(ctx);
          return;
        }
        await this.setEnableMerits(query.from.id, data.value);
        await ctx.answerCbQuery();
        await ctx.editMessageText(`${ctx.i18n.t('ask_for_merits_no')}`);
        this.showMenuKeyboard(ctx);
      }

      if (data.type === 'confirm_uid') {
        if (data.value) {
          await ctx.answerCbQuery();
          await ctx.deleteMessage(query.message.message_id);
          await this.setUid(query.from.id, data.value, ctx.session);
          ctx.session.waitingForUid = false;
          this.session.saveSession(
            this.session.getSessionKey(ctx),
            ctx.session
          );
          askForMentions(ctx);
          return;
        }
        await ctx.answerCbQuery();
        await ctx.deleteMessage(query.message.message_id);
        await ctx.reply(ctx.i18n.t('ask_uid_again'), {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: ctx.i18n.t('dont_know'),
                  callback_data: JSON.stringify({
                    type: 'help_uid',
                    value: true,
                  }),
                },
              ],
            ],
          },
        });
        ctx.session.waitingForUsername = false;
        ctx.session.waitingForUid = true;
      }

      if (data.type === 'help_uid') {
        await ctx.replyWithPhoto('https://i.imgur.com/XFB3TeA.png');
        await ctx.replyWithHTML(
          `${ctx.i18n.t(
            'help_uid'
          )}\n\n<a href="https://bitcointalk.org/index.php?action=profile">Profile URL</a>`
        );
        await ctx.answerCbQuery();
      }

      if (data.type === 'remove_tracked_topic') {
        const topic = await Topic.findOne({ where: { id: data.value } });
        const { tracking } = topic;

        tracking.splice(tracking.indexOf(ctx.chat.id), 1);
        topic.tracking = tracking;

        await topic.save();

        await ctx.answerCbQuery();
        await ctx.replyWithHTML(
          ctx.i18n.t('topic_removed_from_list', { topic })
        );
        await ctx.deleteMessage();
      }

      if (data.type === 'remove_ignore') {
        const ignore = await Ignore.findOne({ where: { id: data.value } });
        const { ignoring } = ignore;

        ignoring.splice(ignoring.indexOf(ctx.chat.id), 1);
        ignore.ignoring = ignoring;

        await ignore.save();
        await ctx.answerCbQuery();
        if (ignore.type === 'user') {
          await ctx.replyWithHTML(
            ctx.i18n.t('ignored_user_removed_from_list', {
              username: ignore.username,
            })
          );
        } else if (ignore.type === 'topic') {
          await ctx.replyWithHTML(
            ctx.i18n.t('ignored_topic_removed_from_List', {
              link: ignore.link,
              title: ignore.title,
            })
          );
        }
        await ctx.deleteMessage();
      }

      if (data.type === 'change_language') {
        const mention = await Mention.findOne({
          where: { chat_id: ctx.chat.id },
        });

        if (mention) {
          mention.language = data.value;
          await mention.save();
        }

        ctx.i18n.locale(data.value);
        ctx.session.language = data.value;

        if (this.keyboard || ctx.session.userChooseLanguage) {
          this.showMenuKeyboard(ctx, ctx.i18n.t('language_changed_success'));
        }

        await ctx.deleteMessage(query.message.message_id);
        await ctx.answerCbQuery();

        if (!ctx.session.userChooseLanguage) {
          ctx.session.userChooseLanguage = true;
          startCommand(ctx);
        }
      }
    });
  }

  async showMenuKeyboard(ctx, message, menu = 'initial') {
    const options = {
      inline: false,
      duplicates: false,
      newline: false,
    };

    this.keyboard = new Keyboard(options);

    const mention = await Mention.findOne({
      where: { chat_id: ctx.chat.id },
    });

    const hasMentionsEnabled = mention ? mention.enable_mentions : false;
    const hasMeritsEnabled = mention ? mention.enable_merits : false;
    const hasNotifyDeletedEnabled = mention ? mention.notify_deleted : false;

    this.keyboard = new Keyboard(options);
    if (menu === 'initial') {
      this.keyboard
        .add(ctx.i18n.t('show_topics'))
        .add(ctx.i18n.t('show_ignore'))
        // .add(ctx.i18n.t('show_commands'))
        .add(ctx.i18n.t('notifications'), ctx.i18n.t('change_language'));
    }

    if (menu === 'notifications') {
      this.keyboard.add(
        hasMentionsEnabled
          ? ctx.i18n.t('disable_mentions')
          : ctx.i18n.t('enable_mentions'),
        hasMeritsEnabled
          ? ctx.i18n.t('disable_merits')
          : ctx.i18n.t('enable_merits'),
        hasNotifyDeletedEnabled
          ? '❌ Disable Deleted Posts'
          : '✅ Enable Deleted Posts'
      );
      this.keyboard.add(ctx.i18n.t('back'));
    }

    await ctx.reply(message || ctx.i18n.t('what_else'), this.keyboard.draw());
  }

  async setUsername(chat_id, username) {
    const exists = await Mention.findOne({
      where: {
        chat_id,
      },
    });
    if (exists) {
      this.logger.info(
        `Updating new username ${username} of chat id ${chat_id}`,
        {
          metadata: { type: 'action', process: 'bot' },
        }
      );
      exists.username = username;
      await exists.save();
    } else {
      this.logger.info(`New mention (user) ${username} of chat id ${chat_id}`, {
        metadata: { type: 'action', process: 'bot' },
      });
      await Mention.create({
        username,
        chat_id,
        enable_mentions: false,
        enable_merits: false,
      });
    }
  }

  async setUid(chat_id, uid, session) {
    const exists = await Mention.findOne({
      where: {
        chat_id,
      },
    });

    if (exists) {
      this.logger.info(`Updating new uid ${uid} of chat id ${chat_id}`, {
        metadata: { type: 'action', process: 'bot' },
      });
      exists.uid = uid;
      await exists.save();
    } else {
      this.bot.telegram.sendMessage(
        chat_id,
        `${this.i18n.t(session.language, 'something_went_wrong')} ${this.i18n.t(
          session.language,
          'run_start'
        )}`
      );
    }
  }

  async setLanguage(chat_id, language) {
    const exists = await Mention.findOne({
      where: {
        chat_id,
      },
    });

    if (exists) {
      exists.language = language;
      await exists.save();
    }
  }

  async setEnableMentions(chat_id, value) {
    const mention = await Mention.findOne({
      where: { chat_id },
    });
    mention.enable_mentions = value;
    await mention.save();
  }

  async setEnableMerits(chat_id, value) {
    const mention = await Mention.findOne({
      where: { chat_id },
    });
    mention.enable_merits = value;
    await mention.save();
  }

  async setEnableDeletedPosts(chat_id, value) {
    const mention = await Mention.findOne({
      where: { chat_id },
    });
    mention.notify_deleted = value;
    await mention.save();
  }

  async changeLanguage(ctx) {
    const options = [];
    const total = Object.keys(ctx.i18n.repository).length;

    for (let x = 1; x <= total; x += 3) {
      options.push([]);
    }

    Object.keys(ctx.i18n.repository).forEach((language, index) => {
      const place = parseInt(index / 3, 10);
      const flag = this.i18n.t(language, 'flag');

      options[place].push({
        text: `${flag} ${language}`,
        callback_data: JSON.stringify({
          type: 'change_language',
          value: language,
        }),
      });
    });

    await ctx.reply(ctx.i18n.t('ask_language'), {
      reply_markup: {
        inline_keyboard: options,
      },
    });
  }

  async addTopic(ctx) {
    const msg = ctx.update.message;
    const topic = msg.text
      .replace('/topic ', '')
      .replace(/#.*/g, '')
      .replace(/.msg.*/g, '')
      .replace(/\.[0-9].*/g, '')
      .replace(/;.*/g, '')
      .trim();

    if (
      topic === '' ||
      topic.indexOf('bitcointalk.org/index.php?topic=') === -1
    ) {
      await ctx.reply(ctx.i18n.t('invalid_topic_url'));
      return;
    }

    if (topic.length > 0) {
      const exists = await Topic.findOne({ where: { link: topic } });

      if (exists) {
        if (exists.tracking.includes(msg.chat.id)) {
          await ctx.reply(ctx.i18n.t('topic_already_in_the_list'));
          return;
        }
        exists.tracking = Sequelize.fn(
          'array_append',
          Sequelize.col('tracking'),
          msg.chat.id
        );
        await exists.save();

        this.logger.info(
          `Tracking: ${ctx.chat.id} is tracking existent topic ${exists.title}`,
          {
            metadata: { type: 'action', process: 'bot' },
          }
        );

        await ctx.replyWithHTML(
          ctx.i18n.t('topic_added_in_the_list', { topic, title: exists.title })
        );
        return;
      }

      const statusMsg = await ctx.reply(ctx.i18n.t('processing'));

      const result = await axios.get(topic, {
        responseType: 'arraybuffer',
        responseEncoding: 'binary',
      });

      const $ = cheerio.load(
        iconv.decode(result.data.toString('binary'), 'ISO-8859-1'),
        {
          decodeEntities: false,
        }
      );

      const title = $('div.nav').find('b:last-child > a.nav').html();
      const author = $(
        'tbody > tr:nth-child(1) > td.poster_info > b > a'
      ).html();
      const id = topic.replace(/^.*topic=|\..*/gi, '');

      if (!title) {
        await ctx.reply(ctx.i18n.t('something_went_wrong_topic'));
        return;
      }

      const addedTopic = await Topic.create({
        id,
        title,
        author,
        link: topic,
        tracking: [msg.chat.id],
      });

      this.logger.info(
        `Tracking: ${ctx.chat.id} is tracking new topic ${title}`,
        {
          metadata: { type: 'action', process: 'bot' },
        }
      );

      await ctx.telegram.editMessageText(
        statusMsg.chat.id,
        statusMsg.message_id,
        undefined,
        ctx.i18n.t('topic_added_in_the_list', {
          topic,
          title: addedTopic.title,
        }),
        { parse_mode: 'HTML' }
      );
    }
  }

  async viewTopics(ctx) {
    const msg = ctx.update.message;
    const topics = await Topic.findAll({
      where: Sequelize.where(
        Sequelize.fn('array_length', Sequelize.col('tracking'), 1),
        { [Op.gt]: 0 }
      ),
      order: [['id', 'DESC']],
    });
    const userTracked = [];

    let message;
    const actionButtons = [];

    message = `<b>${ctx.i18n.t('your_tracked_topics')}</b>\n\n`;
    let counter = 0;

    topics.forEach((topic) => {
      if (topic.tracking.includes(msg.chat.id)) {
        userTracked.push(topic.dataValues);
        counter += 1;
        message += `<b>${counter}.</b> <a href="${topic.dataValues.link}">${topic.dataValues.title}</a>\n`;
        actionButtons.push({
          text: counter,
          callback_data: JSON.stringify({
            type: 'remove_tracked_topic',
            value: topic.dataValues.id,
          }),
        });
      }
    });

    const options = [];
    const total = actionButtons.length;

    for (let x = 1; x <= total; x += 6) {
      options.push([]);
    }

    actionButtons.forEach((button, index) => {
      const place = parseInt(index / 6, 10);

      options[place].push(button);
    });

    message += `\n${ctx.i18n.t('case_want_to_delete_tracked_posts')}`;

    if (userTracked.length > 0) {
      await ctx.replyWithHTML(message, {
        reply_markup: {
          inline_keyboard: options,
        },
      });
    } else {
      message = `${ctx.i18n.t('you_have_no_tracked_posts')}\n\n${ctx.i18n.t(
        'you_can_add_some_with_topic_command'
      )}`;
      await ctx.reply(message);
    }
  }

  async setAltUsername(ctx) {
    const msg = ctx.update.message;
    const altUsername = msg.text.replace('/alt ', '');

    if (altUsername === '/alt') {
      return ctx.reply(ctx.i18n.t('invalid_username'));
    }

    const user = await Mention.findOne({ where: { chat_id: ctx.chat.id } });

    if (!user) {
      return ctx.reply(ctx.i18n.t('something_went_wrong'));
    }

    user.alt_username = altUsername;
    await user.save();

    return ctx.replyWithHTML(`Ok! Alternative username: <b>${altUsername}</b>`);
  }

  async handleIgnoreList(ctx) {
    const msg = ctx.update.message;
    if (
      ctx.message.text === '/ignore' ||
      ctx.message.text.match(ctx.i18n.t('show_ignore'))
    ) {
      const ignoreAll = await Ignore.findAll({
        order: [
          ['type', 'DESC'],
          ['id', 'ASC'],
        ],
      });

      const message = `${ctx.i18n.t('your_ignore_list')}\n\n`;

      let usersIgnored = `<b>Users</b>\n`;
      let topicsIgnored = `<b>Topics</b>\n`;

      let counter = 0;
      let ignores = 0;
      const actionButtons = [];

      ignoreAll.forEach((ignore) => {
        if (ignore.ignoring.includes(msg.chat.id)) {
          counter += 1;
          ignores += 1;
          if (ignore.type === 'user') {
            usersIgnored += `${counter}. <code>${ignore.username}</code>\n`;
          } else if (ignore.type === 'topic') {
            topicsIgnored += `${counter}. <a href="${ignore.link}">${ignore.title}</a>\n`;
          }

          actionButtons.push({
            text: counter,
            callback_data: JSON.stringify({
              type: 'remove_ignore',
              value: ignore.id,
            }),
          });
        }
      });

      const options = [];
      const total = actionButtons.length;

      for (let x = 1; x <= total; x += 6) {
        options.push([]);
      }

      actionButtons.forEach((button, index) => {
        const place = parseInt(index / 6, 10);

        options[place].push(button);
      });

      if (ignores === 0) {
        return ctx.replyWithHTML(
          `${ctx.i18n.t('empty_ignore_list')}\n\n${ctx.i18n.t(
            'ignore_list_help'
          )}`
        );
      }

      const finalMessage = `${message}${usersIgnored}\n${topicsIgnored}\n${ctx.i18n.t(
        'case_want_to_delete_tracked_posts'
      )}`;
      ctx.replyWithHTML(finalMessage, {
        reply_markup: { inline_keyboard: options },
      });
    } else {
      const input = msg.text
        .replace(/\/ignore\s?/gi, '')
        .replace(/#.*/g, '')
        .replace(/\.msg.*/g, '')
        .replace(/\.[0-9].*/g, '')
        .replace(/;.*/g, '')
        .trim();

      if (input.match(/https?:\/\/|bitcointalk\.org/gi)) {
        if (input.indexOf('bitcointalk.org/index.php?topic=') === -1) {
          return ctx.reply(ctx.i18n.t('invalid_topic_url'));
        }

        const exists = await Ignore.findOne({
          where: { type: 'topic', link: input },
        });

        if (exists) {
          if (exists.ignoring.includes(msg.chat.id)) {
            return ctx.reply(ctx.i18n.t('already_ignoring_topic'));
          }

          exists.ignoring = Sequelize.fn(
            'array_append',
            Sequelize.col('ignoring'),
            msg.chat.id
          );
          await exists.save();

          this.logger.info(
            `Ignoring: ${ctx.chat.id} is ignoring existent topic ${exists.title}`,
            {
              metadata: { type: 'action', process: 'bot' },
            }
          );

          return ctx.replyWithHTML(
            ctx.i18n.t('ignoring_topic', {
              addedTopic: exists,
            })
          );
        }

        const statusMsg = await ctx.reply(ctx.i18n.t('processing'));

        const result = await axios.get(input, {
          responseType: 'arraybuffer',
          responseEncoding: 'binary',
        });

        const $ = cheerio.load(
          iconv.decode(result.data.toString('binary'), 'ISO-8859-1'),
          {
            decodeEntities: false,
          }
        );

        const title = $('div.nav').find('b:last-child > a.nav').html();
        const author = $(
          'tbody > tr:nth-child(1) > td.poster_info > b > a'
        ).html();

        if (!title) {
          return ctx.reply(ctx.i18n.t('something_went_wrong_topic'));
        }

        const addedTopic = await Ignore.create({
          type: 'topic',
          title,
          author,
          link: input,
          ignoring: [msg.chat.id],
        });

        this.logger.info(
          `Ignoring: ${ctx.chat.id} is ignoring new topic ${title}`,
          {
            metadata: { type: 'action', process: 'bot' },
          }
        );

        return ctx.telegram.editMessageText(
          statusMsg.chat.id,
          statusMsg.message_id,
          undefined,
          ctx.replyWithHTML(
            ctx.i18n.t('ignoring_topic', {
              addedTopic,
            })
          ),
          { parse_mode: 'HTML' }
        );
      }

      const exists = await Ignore.findOne({
        where: { type: 'user', username: input.toLowerCase() },
      });

      if (exists) {
        if (exists.ignoring.includes(msg.chat.id)) {
          return ctx.reply(ctx.i18n.t('already_ignoring_user'));
        }

        exists.ignoring = Sequelize.fn(
          'array_append',
          Sequelize.col('ignoring'),
          msg.chat.id
        );

        await exists.save();

        this.logger.info(
          `Ignoring: ${ctx.chat.id} is ignoring existent user ${exists.username}`,
          {
            metadata: { type: 'action', process: 'bot' },
          }
        );

        return ctx.replyWithHTML(
          ctx.i18n.t('ignoring_user', { username: exists.username })
        );
      }

      await Ignore.create({
        type: 'user',
        username: input.toLowerCase(),
        ignoring: [msg.chat.id],
      });

      this.logger.info(
        `Ignoring: ${ctx.chat.id} is ignoring new user ${input}`,
        {
          metadata: { type: 'action', process: 'bot' },
        }
      );

      return ctx.replyWithHTML(
        ctx.i18n.t('ignoring_user', { username: input })
      );
    }

    return true;
  }

  sendMention(mention, post) {
    const { chat_id, language, username } = mention;
    const { title, author, content_full, link, id } = post;

    const $ = cheerio.load(content_full);
    const data = $('body');
    data.children('div.quoteheader').remove();
    data.children('div.quote').remove();
    data.find('br').replaceWith('&nbsp;');
    const content = data.text().replace(/\s\s+/g, ' ').trim();

    this.logger.info(
      `${username} ${chat_id} mentioned by ${author} for ${id}`,
      {
        metadata: { type: 'notification', process: 'bot', chat_id },
      }
    );

    this.bot.telegram.sendMessage(
      chat_id,
      `${this.i18n.t(language, 'mentioned_notification', {
        author,
        link,
        title,
      })}\n<pre>${content.substring(0, 150)}${
        content.length > 150 ? '...' : ''
      }</pre>`,
      { parse_mode: 'HTML' }
    );
  }

  async sendReplyInTrackedPost(post, topic, mention, chat_id) {
    const { id, author, link, title, content_full } = post;
    const { language, username } = mention;

    if (username !== post.author) {
      this.logger.info(
        `New post ${id} by ${author} on followed topic ${topic.id} notified to ${chat_id}`,
        {
          metadata: { type: 'notification', process: 'bot', chat_id },
        }
      );

      const $ = cheerio.load(content_full);
      const data = $('body');
      data.children('div.quoteheader').remove();
      data.children('div.quote').remove();
      data.find('br').replaceWith('&nbsp;');
      const content = data.text().replace(/\s\s+/g, ' ').trim();

      await this.bot.telegram.sendMessage(
        parseInt(chat_id, 10),
        `${this.i18n.t(language, 'reply_in_tracked_post_notification', {
          author,
          link,
          title,
        })}\n<pre>${content.substring(0, 150)}${
          content.length > 150 ? '...' : ''
        }</pre>`,
        { parse_mode: 'HTML' }
      );
    }

    await Post.update(
      {
        tracked: Sequelize.fn(
          'array_append',
          Sequelize.col('tracked'),
          chat_id
        ),
      },
      { where: { id: post.id } }
    );
  }

  async sendMeritNotification(mention, merit) {
    const { username, chat_id, language } = mention;
    const {
      id,
      datetime,
      amount,
      sender_username,
      post_title,
      post_link,
    } = merit;

    this.logger.info(
      `${username} ${chat_id} received ${amount} merit id ${id} from ${sender_username} at ${new Date(
        datetime.getTime() + 0 * 60000
      )}`,
      {
        metadata: { type: 'notification', process: 'bot', chat_id },
      }
    );

    await this.bot.telegram.sendMessage(
      chat_id,
      `${this.i18n.t(language, 'merit_notification', {
        amount,
        sender: sender_username,
        link: `https://bitcointalk.org${post_link}`,
        title: post_title,
      })}`,
      { parse_mode: 'HTML' }
    );
  }

  async sendReplyDeleted(post, modlog, mention) {
    const { username, chat_id } = mention;
    const { id, link } = post;

    this.logger.info(
      `${username} ${chat_id} post ${id} gone from deleted parent thread ${modlog.id}`,
      {
        metadata: { type: 'notification', process: 'bot', chat_id },
      }
    );

    await this.bot.telegram.sendMessage(
      chat_id,
      `Your post <a href="${link}">${post.title}</a> is gone because its parent thread was deleted.\n\nYou can see your original post here: https://posts.ninjastic.space/post/${id}`,
      { parse_mode: 'HTML' }
    );
  }

  async sendReplyMultipleDeleted(count, modlog, mention) {
    const { username, chat_id } = mention;

    this.logger.info(
      `${username} ${chat_id} multiple posts gone from deleted parent thread ${modlog.id}`,
      {
        metadata: { type: 'notification', process: 'bot', chat_id },
      }
    );

    await this.bot.telegram.sendMessage(
      chat_id,
      `At least ${count} of your posts are gone because their parent thread was deleted: <a href="http://bitcointalk.org/index.php?topic=${modlog.id}">${modlog.title}</a>\n\nYou can see all the original posts:\nhttps://posts.ninjastic.space/topic/${modlog.id}`,
      { parse_mode: 'HTML' }
    );
  }
}

module.exports = {
  Bot,
};
