import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// --- CONFIGURACIÓN INICIAL ---
const { MONGO_URI, PORT } = process.env;
const app = express();
const port = PORT || 3001;
const mongoClient = new MongoClient(MONGO_URI);

const allowedOrigins = ['https://duende-frontend.vercel.app', 'https://buscador.afland.es'];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('La política de CORS no permite el acceso desde este origen.'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json());

// --- FUNCIÓN PRINCIPAL PARA ARRANCAR EL SERVIDOR ---
async function startServer() {
    try {
        // Conectamos a la base de datos ANTES de que el servidor empiece a escuchar.
        await mongoClient.connect();
        console.log("Conectado exitosamente a la base de datos MongoDB.");

        // Una vez conectados, ponemos el servidor a escuchar peticiones.
        app.listen(port, () => {
            console.log(`API de Duende Finder escuchando en http://localhost:${port}`);
        });

    } catch (error) {
        console.error("Error crítico al conectar con la base de datos:", error);
        process.exit(1);
    }
}

// --- RUTAS DE LA API ---

// Ruta de búsqueda (sin cambios)
app.get('/events', async (req, res) => {
    const { search, timeframe } = req.query;
    try {
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");
        let query = {};
        if (search) {
            query = { $text: { $search: search } };
        } else if (timeframe === 'week') {
            const today = new Date();
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + 7);
            const todayString = today.toISOString().split('T')[0];
            const futureDateString = futureDate.toISOString().split('T')[0];
            query = { date: { $gte: todayString, $lte: futureDateString } };
        }
        const events = await eventsCollection.find(query).sort({ date: 1 }).toArray();
        res.json(events);
    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// Ruta del contador (CORREGIDA)
app.get('/events/count', async (req, res) => {
    console.log("Petición recibida para contar eventos futuros.");
    try {
        // Ya no necesitamos .connect() ni .close() aquí. Usamos la conexión existente.
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        const today = new Date();
        const todayString = today.toISOString().split('T')[0];
        const query = { date: { $gte: todayString } };

        const count = await eventsCollection.countDocuments(query);
        res.json({ total: count });

    } catch (error) {
        console.error("Error al contar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// --- INICIAMOS TODO EL PROCESO ---
startServer();