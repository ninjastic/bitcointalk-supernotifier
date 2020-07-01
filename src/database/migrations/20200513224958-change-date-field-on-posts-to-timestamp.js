module.exports = {
  up: (queryInterface) => {
    return queryInterface.sequelize.query(
      'ALTER TABLE posts ALTER COLUMN date TYPE TIMESTAMP USING date::TIMESTAMP;'
    );
  },

  down: (queryInterface) => {
    return queryInterface.sequelize.query(
      'ALTER TABLE posts ALTER COLUMN date TYPE VARCHAR;'
    );
  },
};
