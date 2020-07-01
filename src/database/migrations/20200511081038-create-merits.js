module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('merits', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      datetime: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      amount: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      sender_username: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      sender_link: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      post_title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      post_link: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      receiver_uid: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      notified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: (queryInterface) => {
    return queryInterface.dropTable('merits');
  },
};
