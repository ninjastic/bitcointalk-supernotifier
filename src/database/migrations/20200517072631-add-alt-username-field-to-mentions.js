module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('mentions', 'alt_username', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  down: (queryInterface) => {
    return queryInterface.removeColumn('mentions', 'alt_username');
  },
};
