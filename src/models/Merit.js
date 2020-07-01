const { Sequelize, DataTypes, Model } = require('sequelize');
const databaseConfig = require('../config/database');

const sequelize = new Sequelize(databaseConfig.url, databaseConfig);

class Merit extends Model {}

Merit.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    datetime: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    sender_username: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    sender_link: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    post_title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    post_link: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    receiver_uid: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    notified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'Merit',
  }
);

module.exports = {
  Merit,
};
