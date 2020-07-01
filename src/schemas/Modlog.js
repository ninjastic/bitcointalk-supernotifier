require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
  useFindAndModify: false,
});

const ModlogSchema = new mongoose.Schema(
  {
    type: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    id: {
      type: Number,
      required: true,
      unique: true,
    },
    notified: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = {
  Modlog: mongoose.model('Modlog', ModlogSchema),
};
