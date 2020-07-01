const { Sequelize, DataTypes, Model } = require('sequelize');
const databaseConfig = require('../config/database');

const sequelize = new Sequelize(databaseConfig.url, databaseConfig);

class Ignore extends Model {}

Ignore.init(
  {
    type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    author: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    link: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    ignoring: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      defaultValue: [],
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'Ignore',
  }
);

module.exports = {
  Ignore,
};
