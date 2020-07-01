module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('posts', 'author_uid', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  down: (queryInterface) => {
    return queryInterface.removeColumn('posts', 'author_uid');
  },
};
