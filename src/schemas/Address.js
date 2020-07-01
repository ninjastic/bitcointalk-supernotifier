require('dotenv').config();
const mongoose = require('mongoose');
const findOrCreate = require('mongoose-findorcreate');

mongoose.connect(process.env.MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
  useFindAndModify: false,
});

const AddressSchema = new mongoose.Schema(
  {
    coin: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
      unique: true,
    },
    mentions: [
      {
        author: {
          type: String,
          required: true,
        },
        author_uid: {
          type: Number,
          required: true,
        },
        post_url: {
          type: String,
          required: true,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

AddressSchema.plugin(findOrCreate);

module.exports = {
  Address: mongoose.model('Address', AddressSchema),
};
