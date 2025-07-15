import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// Configuración (sin cambios)
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
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json());

// --- ¡AQUÍ ESTÁ LA MEJORA! ---
app.get('/events', async (req, res) => {
    const { search, timeframe } = req.query; // Ahora aceptamos 'search' o 'timeframe'
    
    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        const eventsCollection = db.collection("events");

        let query = {};

        // Lógica para la búsqueda por texto (sin cambios)
        if (search) {
            console.log(`Búsqueda de texto recibida: "${search}"`);
            query = { $text: { $search: search } };
        } 
        // Nueva lógica para la precarga de eventos de la semana
        else if (timeframe === 'week') {
            console.log("Petición de eventos para los próximos 7 días recibida.");
            const today = new Date();
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + 7);

            // Formateamos las fechas a YYYY-MM-DD para que coincidan con la base de datos
            const todayString = today.toISOString().split('T')[0];
            const futureDateString = futureDate.toISOString().split('T')[0];
            
            // Creamos la consulta para un rango de fechas
            query = {
                date: {
                    $gte: todayString, // $gte = Greater than or equal to (mayor o igual que)
                    $lte: futureDateString  // $lte = Less than or equal to (menor o igual que)
                }
            };
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

app.listen(port, () => {
    console.log(`API de Duende Finder escuchando en http://localhost:${port}`);
});