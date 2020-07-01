module.exports = {
  up: (queryInterface, Sequelize) => {
    return Promise.all([
      queryInterface.addColumn('mentions', 'uid', {
        type: Sequelize.INTEGER,
        allowNull: true,
      }),
      queryInterface.addColumn('mentions', 'enable_merits', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      }),
    ]);
  },

  down: (queryInterface) => {
    return Promise.all([
      queryInterface.removeColumn('mentions', 'uid'),
      queryInterface.removeColumn('mentions', 'enable_merits'),
    ]);
  },
};
