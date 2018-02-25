const mongoose = require('mongoose');

const { Schema } = mongoose;

const userSchema = new Schema({
  local: {
    username: String,
  },
  google: {
    username: String,
    googleId: String,
  },
});

const User = mongoose.model('user', userSchema);

module.exports = User;
