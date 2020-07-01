const { Sequelize, DataTypes, Model } = require('sequelize');
const databaseConfig = require('../config/database');

const sequelize = new Sequelize(databaseConfig.url, databaseConfig);

class Mention extends Model {}

Mention.init(
  {
    username: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    chat_id: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    enable_mentions: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    uid: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    enable_merits: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    language: {
      type: DataTypes.STRING,
      defaultValue: 'en',
      allowNull: false,
    },
    alt_username: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    notify_deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'Mention',
  }
);

module.exports = {
  Mention,
};
