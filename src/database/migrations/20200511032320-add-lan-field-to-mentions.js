module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('mentions', 'language', {
      type: Sequelize.STRING,
      defaultValue: 'en',
      allowNull: false,
    });
  },

  down: (queryInterface) => {
    return queryInterface.removeColumn('mentions', 'language');
  },
};
