KÉMOLUX — QUICK FIX + SUPABASE SETUP
====================================

WHAT WAS FIXED
- Restored the moving free-delivery marquee.
- Made the bottom navigation fixed on collection, wishlist, cart and other pages.
- Unified collection typography with the site's Montserrat font and corrected dark/black style conflicts.
- Tightened the service page layout, removed the invisible slide-in state that could leave blank space, and normalised service cards.
- Product variations now support multiple types on one item (for example Colour + Size), each with its own labelled selector and optional extra price.
- Products with variations open the product selector before adding to cart.
- Added Supabase Auth integration for sign-up/login, email password recovery, admin role checks, product records/image uploads, cart/wishlist cloud sync, orders, bookings, applications and login history.
- Admin dashboard now requires an authenticated account whose profiles.role is 'admin'.

IMPORTANT: Supabase must be configured before the cloud features work. No credentials were included in the ZIP, so they cannot be pre-connected on your behalf.

SET UP SUPABASE
1. Create/open a project at https://supabase.com.
2. Open Project Settings → API. Copy the Project URL and anon/public key.
3. Open supabase-config.js and replace:
   https://YOUR-PROJECT.supabase.co
   YOUR_SUPABASE_ANON_KEY
   Use only the anon/public key. NEVER put a service_role key in website JavaScript.
4. In Supabase Dashboard → SQL Editor, run the complete supabase-schema.sql file.
5. In Authentication → URL Configuration, set your Site URL to your deployed website URL and add these Redirect URLs:
   - https://YOUR-WEBSITE-DOMAIN/reset-password.html
   - your local development URL if you test locally
6. In Authentication → Providers → Email, keep email/password enabled. For real launch, keep email confirmation enabled.
7. Create your account from index.html and confirm the email if requested.
8. In Supabase → Authentication → Users, open your user and copy its UUID. In SQL Editor run:
   update public.profiles set role='admin' where id='PASTE-YOUR-USER-UUID-HERE';
   Never make every customer an admin.
9. Open login.html and sign in with that authorised account. The admin page checks the role on every load.
10. Deploy all files together, preserving the images/ folder.

PRODUCTS
- Product images uploaded from the admin form go into the public `product-images` Storage bucket created by the SQL script.
- Products published after setup are saved to Supabase and should show across devices.
- Any products that existed only in an older browser's localStorage are not automatically transferred to Supabase. Keep a copy of those product images/details and re-add them once the cloud setup is complete.
- Do not store customer passwords in your own tables. Supabase Auth handles password hashes and recovery emails.

DATA / PRIVACY
- Cart and wishlist sync to the signed-in customer's account. Guest activity is local to that browser.
- Orders, bookings, applications, and customer profiles are shared in Supabase.
- Login history records login/sign-up activity. Passwords are never sent to the admin dashboard.
- The SQL enables row-level security and limits admin data access to profiles with role='admin'.
- Test with a customer account and an admin account before accepting real payments or customer information.
- Checkout currently records orders as Unpaid; it does not process payment.


PRODUCT COLLECTION TROUBLESHOOTING
- This version explicitly saves new products as active=true and shows a readable error if the public collection query fails.
- After publishing, open collection.html and refresh. If the collection shows a Supabase error, copy the exact error message; it usually identifies a table/policy/config issue.
- Confirm Supabase SQL schema was run successfully and the product-images bucket exists. Do not place service_role/secret keys in frontend code.


CUSTOMER SHOPPING FLOW UPDATE
- index.html and home.html are public storefront pages.
- collection.html, cart.html and wishlist.html are public.
- auth.html is customer login/sign-up and is requested at checkout only.
- login.html remains the separate staff/admin login page.
- shipping.html requires an authenticated customer session.
- Paste your existing Supabase project URL and anon key into supabase-config.js before testing Supabase authentication.
- Open the website using VS Code Live Server or another local web server, not file://.
