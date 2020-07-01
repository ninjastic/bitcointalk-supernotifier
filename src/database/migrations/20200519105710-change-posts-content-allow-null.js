module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.changeColumn('posts', 'content', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  down: (queryInterface, Sequelize) => {
    return queryInterface.changeColumn('posts', 'content', {
      type: Sequelize.TEXT,
      allowNull: false,
    });
  },
};
