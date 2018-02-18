const http = require('http');
const app = require('express')();

// Allows for path resolution, which is required by express
const path = require('path');

const server = http.Server(app);
const io = require('socket.io')(server);

const port = process.env.PORT || process.env.NODE_PORT || 3000;

// Start express powered http server
server.listen(port);

app.get('/*', (req, res) => {
  if (req.originalUrl === '/') {
    res.sendFile(path.resolve(`${__dirname}/../client/index.html`));
  } else {
    res.status(404).send('404 - Requested Resource Not Found');
  }
});

const possibleColors = ['#93b881', 'pink', '#95879c', '#fbc97f', 'yellow', 'cyan', 'magenta'];
const users = {};
const words = {};

const onWordUpdate = (socket) => {
  socket.on('wordUpdate', (data) => {
    const { word } = data;
    word.owner = socket.id;
    word.color = users[socket.id].color;
    word.lastUpdate = new Date().getTime();

    const key = `${word.owner}${word.content}`;
    words[key] = word;

    socket.broadcast.emit('wordUpdate', { word });
  });
};

const onWordDelete = (socket) => {
  socket.on('deleteWord', (data) => {
    const { word } = data;
    word.owner = socket.id;
    word.lastUpdate = new Date().getTime();

    const key = `${word.owner}${word.content}`;

    if (words[key]) {
      delete words[key];
      socket.broadcast.emit('deleteWord', { word });
    }
  });
};

const onDisconnect = (socket) => {
  socket.on('disconnect', () => {
    possibleColors.push(users[socket.id].color);
    delete users[socket.id];
  });
};

io.on('connection', (socket) => {
  socket.join('room1');
  onWordUpdate(socket);
  onWordDelete(socket);
  onDisconnect(socket);

  let randomColor;
  if (possibleColors.length > 0) {
    randomColor = possibleColors[Math.floor(Math.random() * possibleColors.length)];
  } else {
    randomColor = 'grey';
  }

  users[socket.id] = { color: randomColor };

  const wordKeys = Object.keys(words);
  for (let i = 0; i < wordKeys.length; i++) {
    socket.emit('wordUpdate', { word: words[wordKeys[i]] });
  }
});
