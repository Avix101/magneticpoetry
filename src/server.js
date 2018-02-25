const http = require('http');
const express = require('express');

const app = express();
const bodyParser = require('body-parser');
const stream = require('stream');

// Integrate socket.io
const server = http.Server(app);
const io = require('socket.io')(server);

// Really helpful passport tut: https://www.youtube.com/watch?v=5VHBy2PjxKs (entire playlist)
const passport = require('passport');
const passportConfig = require('./auth/passport-config.js');

passportConfig.init();

// Set up cookie session
const cookieSession = require('cookie-session');

const cookieS = cookieSession({
  maxAge: 4 * 60 * 60 * 1000,
  keys: [process.env.COOKIE_SECRET],
});

// Connect to Mongo DB using mongoose
const mongoose = require('mongoose');
const User = require('./auth/user-model.js');

mongoose.connect(process.env.MONGODB_URI, () => {

});

// Allows for path resolution, which is required by express
const path = require('path');

// Import Amazon Web Services sdk
const AWS = require('aws-sdk');

// Create a new polly object to handle requests
const polly = new AWS.Polly();

const port = process.env.PORT || process.env.NODE_PORT || 3000;

// Setup cookie sessions
app.use(cookieS);

// Setup passport
app.use(passport.initialize());
app.use(passport.session());

// Setup body parser
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Start express powered http server
server.listen(port);

const isLoggedIn = (req, res, next) => {
  if (!req.user) {
    res.redirect('/login.html');
  } else {
    next();
  }
};

const catchHiddenRequests = (req, res) => {
  switch (req.originalUrl) {
    case '/':
      if (req.user) {
        res.redirect('/members');
      } else {
        res.redirect('/login.html');
      }
      break;
    default:
      res.status(404).send('404 - Requested Resource Not Found');
      break;
  }
};

app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));

app.post('/auth/guest', passport.authenticate('guest-login', {
  successRedirect: '/members',
  failureRedirect: '/login.html',
}));

app.get('/authenticated', passport.authenticate('google'), (req, res) => {
  res.redirect('/members');
});

app.post('/request-tts', (req, res) => {
  polly.synthesizeSpeech({
    OutputFormat: 'mp3',
    Text: req.body.text,
    TextType: 'ssml',
    // VoiceId: 'Mizuki',
    VoiceId: 'Nicole',
  }, (err, data) => {
    if (err) {
      console.log(err);
      res.status(400).send(err);
    } else {
      // Streaming tech taken from:
      // https://medium.com/@smcelhinney/building-a-greeting-app-using-amazon-polly-and-nodejs-a605f29c20f5
      const bufferStream = new stream.PassThrough();
      bufferStream.end(Buffer.from(data.AudioStream));

      res.set({ 'Content-Type': 'audio/mpeg' });

      bufferStream.on('error', (bufferErr) => {
        res.status(400).send(bufferErr);
      });

      bufferStream.pipe(res);
    }
  });
});

app.use('/members/', isLoggedIn, express.static(path.resolve(`${__dirname}/../members`)), catchHiddenRequests);
app.use('/', express.static(path.resolve(`${__dirname}/../client`)), catchHiddenRequests);

const possibleColors = ['#93b881', 'pink', '#95879c', '#fbc97f', 'yellow', 'cyan', 'magenta'];
const users = {};
const words = {};
// const rooms = [];
// const roomIndex = 0;

/* const onCreateRoom = (socket) => {
  socket.on('createRoom', () => {
    newRoomId++;
    const newRoomId = `room${roomIndex}`;

    // const roomObj
  });
}; */

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

const socketAuthCheck = session => session.passport && session.passport.user;

io.on('connection', (socket) => {
  socket.join('room1');
  onWordUpdate(socket);
  onWordDelete(socket);
  onDisconnect(socket);

  users[socket.id] = {};

  // Extract Passport session using sockets
  // Code: https://stackoverflow.com/questions/27174566/how-do-i-access-cookie-session-middleware-in-socket-io-on-nodejs
  const req = { headers: { cookie: socket.request.headers.cookie } };
  const res = { getHeader: () => {}, setHeader: () => {} };

  cookieS(req, res, () => {
    console.log(req.session); // Do something with req.session
    if (socketAuthCheck(req.session)) {
      const id = req.session.passport.user;
      User.findById(id).then((user) => {
        const username = user.google.username || user.local.username || 'Unknown';
        console.log(username);
        users[socket.id].name = username;
        // Emit username
      });
    }
  });

  let randomColor;
  if (possibleColors.length > 0) {
    randomColor = possibleColors[Math.floor(Math.random() * possibleColors.length)];
  } else {
    randomColor = 'grey';
  }

  users[socket.id].color = randomColor;

  const wordKeys = Object.keys(words);
  for (let i = 0; i < wordKeys.length; i++) {
    socket.emit('wordUpdate', { word: words[wordKeys[i]] });
  }
});
