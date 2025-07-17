import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// --- 1. CONFIGURACIÓN INICIAL (SIN CAMBIOS) ---
const { MONGO_URI, PORT } = process.env;
const app = express();
const port = PORT || 3001;

// Instanciamos el cliente UNA SOLA VEZ aquí fuera.
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


// --- 2. FUNCIÓN PRINCIPAL PARA ARRANCAR EL SERVIDOR ---
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
        process.exit(1); // Si no podemos conectar, detenemos la aplicación.
    }
}


// --- 3. RUTAS DE LA API ---
app.get('/events', async (req, res) => {
    // ¡IMPORTANTE! Hemos quitado mongoClient.connect() y .close() de aquí dentro.
    // La conexión ya está abierta y lista para ser usada.
    const { search, timeframe } = req.query;
    
    try {
        const db = mongoClient.db("DuendeDB"); // <-- Usa el nombre de tu base de datos
        const eventsCollection = db.collection("events"); // <-- Usa el nombre de tu colección

        let query = {};

        // Lógica para la búsqueda por texto (sin cambios)
        if (search) {
            console.log(`Búsqueda de texto recibida: "${search}"`);
            query = { $text: { $search: search } };
        } 
        // Nueva lógica para la precarga de eventos de la semana (sin cambios)
        else if (timeframe === 'week') {
            console.log("Petición de eventos para los próximos 7 días recibida.");
            const today = new Date();
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + 7);

            const todayString = today.toISOString().split('T')[0];
            const futureDateString = futureDate.toISOString().split('T')[0];
            
            query = {
                date: {
                    $gte: todayString,
                    $lte: futureDateString
                }
            };
        }

        const events = await eventsCollection.find(query).sort({ date: 1 }).toArray();
        res.json(events);

    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
    // Ya no hay bloque "finally" para cerrar la conexión.
});

// --- 4. INICIAMOS TODO EL PROCESO ---
startServer();