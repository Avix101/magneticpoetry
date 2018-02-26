const mongoose = require('mongoose');

const { Schema } = mongoose;

const boardSchema = new Schema({
  name: String,
  owner: String,
  board: Object,
});

const Board = mongoose.model('board', boardSchema);

module.exports = Board;
