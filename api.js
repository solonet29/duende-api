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

// --- RUTA DE BÚSQUEDA (CON LA MEJORA) ---
app.get('/events', async (req, res) => {
    const { search, timeframe } = req.query;
    
    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        // --- ¡AQUÍ ESTÁ LA MEJORA! ---
        // 1. Definimos la fecha de hoy para usarla como filtro base.
        const today = new Date();
        const todayString = today.toISOString().split('T')[0];

        // 2. Creamos una consulta base que SIEMPRE filtrará por fechas futuras.
        let query = {
            date: { $gte: todayString } // $gte = "mayor o igual que"
        };

        // 3. Añadimos las condiciones de búsqueda a la consulta base.
        if (search) {
            console.log(`Búsqueda de texto recibida: "${search}"`);
            // Combinamos el filtro de fecha con el de texto
            query = { ...query, $text: { $search: search } };
        } 
        else if (timeframe === 'week') {
            console.log("Petición de eventos para los próximos 7 días recibida.");
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + 7);
            const futureDateString = futureDate.toISOString().split('T')[0];
            
            // Combinamos el filtro de fecha de inicio con el de fecha de fin
            query.date.$lte = futureDateString; // $lte = "menor o igual que"
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

// Ruta del contador (sin cambios)
app.get('/events/count', async (req, res) => {
    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");
        const today = new Date();
        const todayString = today.toISOString().split('T')[0];
        const query = { date: { $gte: todayString } };
        const count = await eventsCollection.countDocuments(query);
        res.json({ total: count });
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor." });
    } finally {
        await mongoClient.close();
    }
});


app.listen(port, () => {
    console.log(`API de Duende Finder escuchando en http://localhost:${port}`);
});