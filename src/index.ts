import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

dotenv.config();

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'bountiful',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
    res.json({ message: 'Bountiful API is running' });
});

app.get('/plants', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM plants ORDER BY name ASC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching plants:', error);
        res.status(500).json({ error: 'Failed to fetch plants' });
    }
});

app.get('/plants/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM plants WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Plant not found' });
        } else {
            res.json(result.rows[0]);
        }
    } catch (error) {
        console.error('Error fetching plant:', error);
        res.status(500).json({ error: 'Failed to fetch plant' });
    }
});

app.post('/identify', async (req, res) => {
    /* function to send user's image from camera to plant.id API and return species name */
    try {
        const { image } = req.body;

        const response = await fetch('https://api.plant.id/v3/identification', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Api-Key': process.env.PLANT_API_KEY || '',
            },
            body: JSON.stringify({
                images: [image],
                classification_level: 'species',
            }),
        });

        const result = await response.json();
        res.json(result);
    } catch (error) {
        console.error('Plant identification error', error);
        res.status(500).json({ error: "Couldn't identify plant" });
    }
});

app.post('/register', async (req, res) => {
    /* takes users registration details, hashes the password, saves user info to db, and returns registration details */
    
    try{
        const {email, password, username} = req.body;
        if (!email || !password || !username) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, username) VALUES ($1, $2, $3) RETURNING id, email, username',
            [email, passwordHash, username]
        );
        res.status(201).json(result.rows[0]);
    } catch(error) {
        console.error(error);
        res.status(500).json({ error: 'Registration failed' });
    }
})

app.post('/login', async (req, res) => {

    try{
        const {email, password} = req.body;
        
        //finding user account
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Email not found' });
        }
        
        //checking whether passwords match
        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Wrong password' });
        }

        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET_KEY || '',
            { expiresIn: '7d' }
        );
        
        res.json({ token });

    } catch(error) {
        console.error(error);
        res.status(500).json({ error: 'Login failed'})
    }
})

// Save a user's foraging spot to the database
app.post('/spots', async (req, res) => {
    try {
        const { userId, latitude, longitude, notes, plantId } = req.body;
        const result = await pool.query(
            'INSERT INTO foraging_spots (user_id, latitude, longitude, notes, plant_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [userId, latitude, longitude, notes, plantId || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error saving spot:', error);
        res.status(500).json({ error: 'Failed to save spot' });
    }
});

// Retrieve a user's logged foraging spots
app.get('/spots/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await pool.query(
            `SELECT fs.*, p.name as plant_name 
             FROM foraging_spots fs
             LEFT JOIN plants p ON fs.plant_id = p.id
             WHERE fs.user_id = $1`,
            [userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching spots:', error);
        res.status(500).json({ error: 'Failed to fetch spots' });
    }
});

// Find plant by latin name
app.get('/plants/latin/:latinName', async (req, res) => {
    try {
        const { latinName } = req.params;
        const result = await pool.query(
            'SELECT * FROM plants WHERE latin_name ILIKE $1',
            [latinName]
        );
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Plant not in database' });
        } else {
            res.json(result.rows[0]);
        }
    } catch (error) {
        console.error('Error finding plant:', error);
        res.status(500).json({ error: "Couldn't find plant" });
    }
});

//Add unlocked plants
app.post('/unlock', async (req, res) => {
    try {
        const { userId, plantId } = req.body;
        const result = await pool.query(
            'INSERT INTO unlocked_plants (user_id, plant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [userId, plantId]
        );
        res.status(201).json(result.rows[0] || { message: 'Already unlocked' });
    } catch (error) {
        console.error('Error unlocking plant:', error);
        res.status(500).json({ error: 'Failed to unlock plant' });
    }
});

pool.query('SELECT NOW()', (err: Error | null, res: any) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Database connected:', res.rows[0]);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});