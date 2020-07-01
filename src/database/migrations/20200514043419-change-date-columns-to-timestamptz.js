module.exports = {
  up: (queryInterface) => {
    return Promise.all([
      queryInterface.sequelize.query(
        'ALTER TABLE posts ALTER COLUMN date TYPE TIMESTAMPTZ USING date::TIMESTAMPTZ;'
      ),
      queryInterface.sequelize.query(
        'ALTER TABLE merits ALTER COLUMN datetime TYPE TIMESTAMPTZ USING datetime::TIMESTAMPTZ;'
      ),
    ]);
  },

  down: (queryInterface) => {
    return Promise.all([
      queryInterface.sequelize.query(
        'ALTER TABLE posts ALTER COLUMN date TYPE TIMESTAMP USING date::TIMESTAMP;'
      ),
      queryInterface.sequelize.query(
        'ALTER TABLE merits ALTER COLUMN datetime TYPE TIMESTAMP USING datetime::TIMESTAMP;'
      ),
    ]);
  },
};
