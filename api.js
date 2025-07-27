import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// --- CONFIGURACIÓN ---
const { MONGO_URI, PORT } = process.env;
if (!MONGO_URI) {
    throw new Error('La variable de entorno MONGO_URI no está definida.');
}
const app = express();
const port = PORT || 3001;

// --- CLIENTE DE MONGODB ---
const mongoClient = new MongoClient(MONGO_URI);
let db;

// --- MIDDLEWARE ---
const allowedOrigins = [
    'https://duende-frontend.vercel.app', 
    'https://buscador.afland.es',
    'http://localhost:3000'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};

app.use(cors(corsOptions));
app.use(express.json());

// --- RUTAS DE LA API ---

// RUTA PRINCIPAL DE BÚSQUEDA DE EVENTOS
app.get('/events', async (req, res) => {
    const { search, artist, city, country, dateFrom, dateTo, timeframe } = req.query;
    
    try {
        const eventsCollection = db.collection("events");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const filterConditions = [];

        filterConditions.push({ date: { $gte: today.toISOString().split('T')[0] } });

        if (city) {
            const cityRegex = new RegExp(city, 'i');
            filterConditions.push({
                $or: [
                    { city: cityRegex },
                    { provincia: cityRegex }
                ]
            });
        }
        
        if (country) {
            filterConditions.push({ country: { $regex: new RegExp(`^${country}$`, 'i') } });
        }

        if (artist) {
            filterConditions.push({ artist: { $regex: new RegExp(artist, 'i') } });
        }
        if (dateFrom) {
            filterConditions[0].date.$gte = dateFrom;
        }
        if (dateTo) {
            filterConditions[0].date.$lte = dateTo;
        }
        
        if (timeframe === 'week' && !dateTo) {
            const nextWeek = new Date(today);
            nextWeek.setDate(today.getDate() + 7);
            filterConditions[0].date.$lte = nextWeek.toISOString().split('T')[0];
        }

        if (search) {
            filterConditions.push({ $text: { $search: search } });
        }

        const finalFilter = filterConditions.length > 1 ? { $and: filterConditions } : filterConditions[0] || {};
        
        console.log("Ejecutando consulta con filtro:", JSON.stringify(finalFilter, null, 2));
        
        const events = await eventsCollection.find(finalFilter).sort({ date: 1 }).toArray();

        // --- INICIO: LÓGICA PARA ELIMINAR DUPLICADOS ---
        const uniqueEvents = new Map();

        events.forEach(event => {
            // Se crea una clave única basada en el artista, la fecha y la hora.
            const key = `${event.artist?.toLowerCase().trim()}|${event.date}|${event.time}`;
            const existingEvent = uniqueEvents.get(key);

            // Si no hemos visto este evento, lo añadimos.
            if (!existingEvent) {
                uniqueEvents.set(key, event);
            } else {
                // Si ya existe, aplicamos la regla: preferimos el que tiene sourceURL.
                // Si el evento que ya tenemos guardado NO tiene URL, pero el nuevo SÍ la tiene, lo reemplazamos.
                if (!existingEvent.sourceURL && event.sourceURL) {
                    uniqueEvents.set(key, event);
                }
            }
        });

        const filteredEvents = Array.from(uniqueEvents.values());
        // --- FIN: LÓGICA PARA ELIMINAR DUPLICADOS ---

        res.json(filteredEvents); // Enviamos la lista ya filtrada

    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// RUTA PARA CONTAR EVENTOS
app.get('/events/count', async (req, res) => {
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


// --- FUNCIÓN PARA INICIAR EL SERVIDOR ---
async function startServer() {
    try {
        await mongoClient.connect();
        console.log("Conectado a MongoDB correctamente.");
        db = mongoClient.db("DuendeDB");

        app.listen(port, () => {
            console.log(`Servidor escuchando en http://localhost:${port}`);
        });
    } catch (error) {
        console.error("No se pudo conectar a MongoDB o iniciar el servidor:", error);
        process.exit(1);
    }
}

// --- INICIO ---
startServer();