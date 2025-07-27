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
// Conectamos una sola vez y reutilizamos el cliente.
const mongoClient = new MongoClient(MONGO_URI);
let db;

// --- MIDDLEWARE ---
const allowedOrigins = [
    'https://duende-frontend.vercel.app', 
    'https://buscador.afland.es',
    'http://localhost:3000' // Añadido para desarrollo local
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
    const { search, artist, city, dateFrom, dateTo, timeframe } = req.query;
    
    try {
        const eventsCollection = db.collection("events");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const filterConditions = [];

        // 1. Filtro base por fecha
        filterConditions.push({ date: { $gte: today.toISOString().split('T')[0] } });

        // 2. Añadimos filtros adicionales
        if (city) {
            // --- CAMBIO IMPORTANTE AQUÍ ---
            // Hemos eliminado '^' y '$' para que busque la ciudad como parte del texto (provincia)
            // en lugar de una coincidencia exacta.
            filterConditions.push({ city: { $regex: new RegExp(city, 'i') } });
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
        res.json(events);

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
        // Conectamos al iniciar
        await mongoClient.connect();
        console.log("Conectado a MongoDB correctamente.");
        db = mongoClient.db("DuendeDB"); // Asignamos la instancia de la BD a la variable global

        // Iniciamos el servidor Express
        app.listen(port, () => {
            console.log(`Servidor escuchando en http://localhost:${port}`);
        });
    } catch (error) {
        console.error("No se pudo conectar a MongoDB o iniciar el servidor:", error);
        process.exit(1); // Salimos si no podemos conectar a la BD
    }
}

// --- INICIO ---
startServer();
