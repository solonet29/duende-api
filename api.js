import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// --- CONFIGURACIÓN (Sin cambios) ---
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

// --- RUTA DE BÚSQUEDA (Sin cambios) ---
app.get('/events', async (req, res) => {
    const { search, timeframe } = req.query;
    try {
        await mongoClient.connect();
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
        res.status(500).json({ error: "Error interno del servidor." });
    } finally {
        await mongoClient.close();
    }
});

// --- ¡NUEVA RUTA PARA EL CONTADOR DE EVENTOS! ---
app.get('/events/count', async (req, res) => {
    console.log("Petición recibida para contar eventos futuros.");
    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        // Creamos una consulta para contar solo los eventos con fecha de hoy en adelante
        const today = new Date();
        const todayString = today.toISOString().split('T')[0];
        const query = { date: { $gte: todayString } };

        const count = await eventsCollection.countDocuments(query);
        
        // Devolvemos el número en un objeto JSON
        res.json({ total: count });

    } catch (error) {
        console.error("Error al contar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    } finally {
        await mongoClient.close();
    }
});


app.listen(port, () => {
    console.log(`API de Duende Finder escuchando en http://localhost:${port}`);
});