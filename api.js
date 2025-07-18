import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

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

app.get('/events', async (req, res) => {
    // AÑADIMOS 'city' a los parámetros que podemos recibir
    const { search, timeframe, city } = req.query;
    
    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        const today = new Date();
        const todayString = today.toISOString().split('T')[0];
        let query = { date: { $gte: todayString } };

        if (search) {
            query = { ...query, $text: { $search: search } };
        } 
        // ¡NUEVA LÓGICA! Si recibimos un filtro de ciudad, lo añadimos a la consulta
        else if (city) {
            console.log(`Petición de eventos para la ciudad: "${city}"`);
            query = { ...query, city: city };
        }
        else if (timeframe === 'week') {
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + 7);
            const futureDateString = futureDate.toISOString().split('T')[0];
            query.date.$lte = futureDateString;
        }

        const events = await eventsCollection.find(query).sort({ date: 1 }).toArray();
        res.json(events);

    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    } finally {
        await mongoClient.close();
    }
});

// La ruta /events/count no cambia
app.get('/events/count', async (req, res) => { /* ...código sin cambios... */ });

app.listen(port, () => {
    console.log(`API de Duende Finder escuchando en http://localhost:${port}`);
});