const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { MongoClient } = require("mongodb");
require('dotenv').config();
const cors = require("cors");


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ================================
// MONGODB
// ================================

const MONGO_URL = process.env.MONGO_URL;
const client = new MongoClient(MONGO_URL);

let db;
let ajomerkinnatCollection;

// ================================
// AKTIIVINEN VUORO (RAM)
// ================================
let aktiivinenVuoro = null;

// ================================
// APUFUNKTIOT
// ================================
function nowTime() {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

function nowDate() {
  const now = new Date();
  return `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
}

// ================================
// SIVUT
// ================================

app.get('/ajomerkinnat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

// ================================
// AJOMERKINNÄT API
// ================================
app.get('/api/ajomerkinnat', async (req, res) => {
  const data = await ajomerkinnatCollection.find().toArray();
  res.json(data);
});

// ================================
// AKTIIVINEN VUORO
// ================================
app.get('/api/aktiivinen', (req, res) => {
  res.json(aktiivinenVuoro);
});

// ================================
// ALOITA VUORO
// ================================
app.post('/api/aloita', (req, res) => {
  if (aktiivinenVuoro) {
    return res.status(400).json({
      success: false,
      message: 'Vuoro on jo käynnissä'
    });
  }

  aktiivinenVuoro = {
    paiva: nowDate(),
    aloitus: nowTime(),
    tila: "ajo",
    nykyinenJaksoAlku: nowTime(),
    tauot: []
  };

  io.emit('aktiivinen_paivitetty', aktiivinenVuoro);

  res.json({ success: true });
});

// ================================
// TAUKO
// ================================
app.post('/api/tauko', (req, res) => {
  if (!aktiivinenVuoro || aktiivinenVuoro.tila !== 'ajo') {
    return res.status(400).json({ success: false });
  }

  aktiivinenVuoro.tauot.push({
    alku: nowTime(),
    loppu: null
  });

  aktiivinenVuoro.tila = "tauko";
  aktiivinenVuoro.nykyinenJaksoAlku = nowTime();

  io.emit('aktiivinen_paivitetty', aktiivinenVuoro);

  res.json({ success: true });
});

// ================================
// JATKA TAUKO
// ================================
app.post('/api/jatka', (req, res) => {
  if (!aktiivinenVuoro || aktiivinenVuoro.tila !== 'tauko') {
    return res.status(400).json({ success: false });
  }

  const viimeinenTauko = aktiivinenVuoro.tauot[aktiivinenVuoro.tauot.length - 1];
  viimeinenTauko.loppu = nowTime();

  aktiivinenVuoro.tila = "ajo";
  aktiivinenVuoro.nykyinenJaksoAlku = nowTime();

  io.emit('aktiivinen_paivitetty', aktiivinenVuoro);

  res.json({ success: true });
});

// ================================
// LOPETA VUORO (MONGODB)
// ================================
app.post('/api/lopeta', async (req, res) => {
  if (!aktiivinenVuoro) {
    return res.status(400).json({ success: false });
  }

  const valmisVuoro = {
    paiva: aktiivinenVuoro.paiva,
    aloitus: aktiivinenVuoro.aloitus,
    lopetus: nowTime(),
    tauot: aktiivinenVuoro.tauot.filter(t => t.loppu)
  };

  await ajomerkinnatCollection.insertOne(valmisVuoro);

  aktiivinenVuoro = null;

  const data = await ajomerkinnatCollection.find().toArray();

  io.emit('aktiivinen_paivitetty', null);
  io.emit('ajomerkinnat_paivitetty', data);

  res.json({ success: true });
});

// ================================
// SOCKET
// ================================
io.on('connection', async (socket) => {
  console.log('Asiakas yhdistetty');

  socket.emit('aktiivinen_paivitetty', aktiivinenVuoro);

  const data = await ajomerkinnatCollection.find().toArray();
  socket.emit('ajomerkinnat_paivitetty', data);

  socket.on('disconnect', () => {
    console.log('Asiakas katkaisi yhteyden');
  });
});

// ================================
// SERVER START
// ================================
async function start() {
  try {
    await client.connect();

    db = client.db("taksidata");
    ajomerkinnatCollection = db.collection("ajomerkinnat");

    console.log("MongoDB yhdistetty");

    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });

  } catch (err) {
    console.error("MongoDB yhteys epäonnistui:", err);
    process.exit(1);
  }
}
start();