# BitcoinTalk SuperNotifier

A bot made in Node.js that notifies users on Telegram about new mentions, quotes and merits from BitcoinTalk.

![](https://i.imgur.com/RSb4YlK.gif)

## Features

- Mention/quote notification
- Merit notification
- Topic tracking with notifications
- Internationalization (multi lingual)
- Toggle merits OR mentions notifications at any time with a cool menu
- Ignore members or topics so you don't get notifications from them
- Notifications when your post gets deleted because the parent thread got trashed

## Commands

- /start - to start the bot or unstuck it if anything happens
- /menu - opens/updates the cool menu
- /topic (url) - adds a topic to your tracking list
- /topics - show all topics in your tracking list
- /language - shows the language change prompt
- /alt (username) - sets an alternative nickname for mentions detection
- /ignore - shows your ignore list
- /ignore (url/username) - adds an user or topic to your ignore list

## Hosting it youself

1. Requirements

- Node v12.x
- PostgreSQL
- MongoDB
- Telegram Bot

2. Clone the repository

   - `git clone https://github.com/vitorhariel/bitcointalk-supernotifier.git`

3. Install the dependencies

   - `npm install`

4. Copy the `.env.example` file to `.env` and configure the variables

5. Run the database migrations

   - `npx sequelize db:migrate`

6. Run the app and the scrapper
   - `npm run start:app`
   - `npm run start:scrapper`
