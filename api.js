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
    // Extraemos todos los posibles parámetros de la query
    const { search, artist, city, dateFrom, dateTo, timeframe } = req.query;
    
    try {
        const eventsCollection = db.collection("events");
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Aseguramos que la comparación sea desde el inicio del día

        // Usamos un array de filtros para combinarlos con $and
        const filterConditions = [];

        // 1. Filtro base por fecha: siempre buscar eventos desde hoy
        filterConditions.push({ date: { $gte: today.toISOString().split('T')[0] } });

        // 2. Añadimos filtros adicionales si existen
        if (city) {
            // Búsqueda exacta por ciudad, insensible a mayúsculas/minúsculas
            filterConditions.push({ city: { $regex: new RegExp(`^${city}$`, 'i') } });
        }
        if (artist) {
            // Búsqueda de subcadena en artista, insensible a mayúsculas/minúsculas
            filterConditions.push({ artist: { $regex: new RegExp(artist, 'i') } });
        }
        if (dateFrom) {
            // Si hay 'dateFrom', lo usamos. Si no, el filtro base de "hoy" se mantiene.
            filterConditions[0].date.$gte = dateFrom;
        }
        if (dateTo) {
            // Añadimos la condición de fecha final si existe
            filterConditions[0].date.$lte = dateTo;
        }
        
        // 3. Manejo del 'timeframe' para la carga inicial
        if (timeframe === 'week' && !dateTo) {
            const nextWeek = new Date(today);
            nextWeek.setDate(today.getDate() + 7);
            filterConditions[0].date.$lte = nextWeek.toISOString().split('T')[0];
        }

        // 4. Manejo de la búsqueda de texto general (si existe)
        if (search) {
            // Este filtro es especial y usa un índice de texto en MongoDB
            filterConditions.push({ $text: { $search: search } });
        }

        // 5. Construimos la consulta final
        // Si hay más de una condición, las unimos con $and. Si no, usamos la única condición.
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
