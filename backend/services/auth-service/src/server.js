import app from './index.js';
const port = Number(process.env.PORT || 4101);
app.listen(port, () => console.log(`Auth service listening on ${port}`));