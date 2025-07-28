import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// --- CONFIGURACIÓN ---
const { MONGO_URI, GEMINI_API_KEY } = process.env;
if (!MONGO_URI) {
    throw new Error('La variable de entorno MONGO_URI no está definida.');
}
if (!GEMINI_API_KEY) {
    throw new Error('La variable de entorno GEMINI_API_KEY no está definida.');
}
const app = express();
const mongoClient = new MongoClient(MONGO_URI);
let db;

// Conectar a la base de datos una sola vez
await mongoClient.connect();
db = mongoClient.db("DuendeDB");
console.log("Conectado a MongoDB.");

// --- MIDDLEWARE ---
// --- MIDDLEWARE ---
const allowedOrigins = [
    'https://duende-frontend.vercel.app', 
    'https://buscador.afland.es',
    'http://localhost:3000'
];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Origen no permitido por CORS'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json());

// --- RUTAS DE LA API ---

// RUTA PRINCIPAL DE BÚSQUEDA DE EVENTOS
app.get('/api/events', async (req, res) => {
    const { search, artist, city, country, dateFrom, dateTo, timeframe } = req.query;
    
    try {
        const eventsCollection = db.collection("events");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const filter = {
            date: { $gte: today.toISOString().split('T')[0] }
        };

        if (city) {
            const cityRegex = new RegExp(city, 'i');
            filter.$or = [ { city: cityRegex }, { provincia: cityRegex } ];
        }
        if (country) {
            filter.country = { $regex: new RegExp(`^${country}$`, 'i') };
        }
        if (artist) {
            filter.artist = { $regex: new RegExp(artist, 'i') };
        }
        if (dateFrom) {
            filter.date.$gte = dateFrom;
        }
        if (dateTo) {
            filter.date.$lte = dateTo;
        }
        if (timeframe === 'week' && !dateTo) {
            const nextWeek = new Date(today);
            nextWeek.setDate(today.getDate() + 7);
            filter.date.$lte = nextWeek.toISOString().split('T')[0];
        }
        if (search) {
            filter.$text = { $search: search };
        }

        const aggregationPipeline = [
            { $match: filter },
            { $sort: { date: 1, verified: -1, sourceURL: -1 } },
            {
                $group: {
                    _id: { artist: "$artist", date: "$date", time: "$time" },
                    doc: { $first: "$$ROOT" }
                }
            },
            { $replaceRoot: { newRoot: "$doc" } },
            { $sort: { date: 1 } }
        ];
        
        const events = await eventsCollection.aggregate(aggregationPipeline).toArray();
        res.json(events);

    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// RUTA PARA CONTAR EVENTOS
app.get('/api/events/count', async (req, res) => {
    try {
        const eventsCollection = db.collection("events");
        const todayString = new Date().toISOString().split('T')[0];
        const count = await eventsCollection.countDocuments({ date: { $gte: todayString } });
        res.json({ total: count });
    } catch (error) {
        console.error("Error al contar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// RUTA PARA ENMASCARAR LA API DE GEMINI
app.post('/api/gemini', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'Falta el prompt en la petición' });
    }
    try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const payload = {
            contents: [{ role: "user", parts: [{ text: prompt }] }]
        };
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!geminiResponse.ok) {
            console.error('Error desde la API de Gemini:', await geminiResponse.text());
            return res.status(geminiResponse.status).json({ error: 'Error al contactar la API de Gemini' });
        }
        const data = await geminiResponse.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        res.status(200).json({ text: text });
    } catch (error) {
        console.error('Error interno del servidor en la ruta /api/gemini:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// Exporta la app para que Vercel la pueda usar
export default app;