# 🥛 Living Dairies

A complete milk delivery website with admin panel.
**Stack:** TypeScript · Node.js · Express · SQLite · EJS

---

## Quick Start

### macOS / Linux / PowerShell (with RemoteSigned)
```bash
# 1. Install dependencies
npm install

# 2. Copy env file and edit credentials
cp .env.example .env

# 3. Run in dev mode
npm run dev
```

### Windows (without RemoteSigned policy / Command Prompt)
```cmd
# 1. Install dependencies
npm.cmd install

# 2. Copy env file and edit credentials
copy .env.example .env

# 3. Run in dev mode
npm.cmd run dev
```

Then open:
- **Public site:** http://localhost:3000
- **Admin panel:** http://localhost:3000/admin/login

**Default admin credentials:** `admin` / `dairies123`
⚠️ **Change these immediately** by editing `.env` before first run, or via the database.

---

## Environment Variables

Create a `.env` file in the root directory (copied from `.env.example`) and configure the following variables:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | The port the Express web server listens on. | `3000` |
| `SESSION_SECRET` | Secret key used to sign the session cookie. Use a strong random key in production. | `change-this-to-a-long-random-string-in-production` |
| `ADMIN_USERNAME` | Admin login username. | `admin` |
| `ADMIN_PASSWORD` | Admin login password. | `dairies123` |

---

## Running with Docker

You can run the application in either development or production modes using Docker and Docker Compose.

### Development Mode (with Hot-Reloading)

The development setup mounts the codebase into the container so that any changes you make locally are reflected immediately without rebuilding.

```bash
# Start in development mode (hot-reloading enabled)
docker-compose up -d web-dev

# View real-time logs
docker-compose logs -f web-dev

# Stop development environment
docker-compose down
```

- **Public Site:** http://localhost:3000
- **Admin Panel:** http://localhost:3000/admin/login

### Production Mode

The production build uses a multi-stage `Dockerfile` to optimize the container size and performance.

```bash
# Build and start in production mode
docker-compose up -d web-prod --build

# View logs
docker-compose logs -f web-prod

# Stop production environment
docker-compose down
```

- **Public Site:** http://localhost:8080
- **Admin Panel:** http://localhost:8080/admin/login

---

## Project Structure

```
livingdairies-app/
├── src/
│   ├── server.ts             # Express app entry
│   ├── db.ts                 # SQLite setup + schema + queries
│   ├── types.d.ts            # Session typings
│   ├── routes/
│   │   ├── api.ts            # Public API (products, orders)
│   │   └── admin.ts          # Admin routes (login, dashboard, …)
│   └── middleware/
│       └── auth.ts           # Admin login guard
├── views/admin/              # EJS templates
│   ├── login.ejs
│   ├── dashboard.ejs
│   ├── products.ejs
│   ├── orders.ejs
│   ├── orders-completed.ejs
│   ├── _head.ejs             # partials
│   ├── _sidebar.ejs
│   └── _flash.ejs
├── public/                   # Public site (static)
│   ├── index.html
│   ├── about.html
│   ├── order.html
│   ├── thankyou.html
│   ├── styles.css
│   └── admin.css
├── data/                     # Auto-created
│   ├── livingdairies.db      # SQLite database
│   └── sessions.db           # Sessions store
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Database Schema

**`products`** — id, name, description, price, image_url, created_at
**`orders`** — id, customer_name, customer_phone, customer_address, product_id, quantity, total_price, status, notes, created_at
**`admins`** — id, username, password_hash (bcrypt)

Schema is auto-created on first run. One default product (Fresh Farm Milk @ Rs 245/L) and one admin user are seeded.

Order status flow: `pending` → `in_delivery` → `completed`

---

## API Endpoints

### Public
- `GET /api/products` — list products
- `POST /api/orders` — place an order
  ```json
  { "productId": 1, "quantity": 2, "name": "...", "phone": "...", "address": "...", "notes": "" }
  ```

### Admin (session-protected)
- `GET  /admin/login`
- `POST /admin/login`
- `POST /admin/logout`
- `GET  /admin`                        — dashboard
- `GET  /admin/products`               — manage products
- `POST /admin/products/add`
- `POST /admin/products/:id/delete`
- `GET  /admin/orders`                 — active orders (pending + in_delivery)
- `GET  /admin/orders/completed`       — archive
- `POST /admin/orders/:id/status`      — update status

---

## Production Deployment

1. Set strong `SESSION_SECRET` in `.env`
2. Change `ADMIN_USERNAME` / `ADMIN_PASSWORD`
3. Build: `npm run build`
4. Run: `npm start`
5. Reverse-proxy with HTTPS (nginx, Caddy)
6. Set `cookie.secure = true` in `src/server.ts` if behind HTTPS

---

## What's Next (when you want it)

- Email/SMS notifications on new orders
- Customer accounts & order history
- Payment gateway (Stripe / JazzCash / EasyPaisa)
- Image upload (instead of pasting URLs)
- GPS delivery tracking
- Subscription / recurring orders
