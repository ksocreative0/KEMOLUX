console.log("KÉMOLUX SCRIPT LOADED");

/* KÉMOLUX storefront — browser-storage prototype.
   Use a secure backend before taking real customer data. */

/* =========================================================
   1. SUPABASE SETUP AND STORAGE HELPERS
========================================================= */

const SUPABASE_READY = !!(
    window.supabase?.createClient &&
    window.KEMOLUX_SUPABASE_URL &&
    !window.KEMOLUX_SUPABASE_URL.includes("YOUR-PROJECT") &&
    window.KEMOLUX_SUPABASE_ANON_KEY &&
    !window.KEMOLUX_SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")
);

const db = SUPABASE_READY
    ? window.supabase.createClient(
        window.KEMOLUX_SUPABASE_URL,
        window.KEMOLUX_SUPABASE_ANON_KEY
    )
    : null;

window.kemoluxDb = db;

const STORE = {
    users: "kemolux_users",
    active: "kemolux_active",
    products: "products",
    orders: "kemolux_orders",
    logins: "kemolux_login_history",
    appointments: "kemolux_appointments",
    applications: "kemolux_applications",
    customers: "kemolux_customers"
};

const read = (key, fallback = []) => {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        return fallback;
    }
};

const write = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
};

let products = read(STORE.products, []);
let currentFilter = "all";
let collectionSearchTerm = "";

function activeUser() {
    return read(STORE.active, null);
}

function userKey(type) {
    const user = activeUser();
    return `kemolux_${type}_${user?.email || "guest"}`;
}

function userData(type) {
    return read(userKey(type), []);
}

function setUserData(type, data) {
    write(userKey(type), data);

    if (!SUPABASE_READY) return;

    const user = activeUser();

    if (!user?.id || !["cart", "wishlist"].includes(type)) {
        return;
    }

    db.from("customer_state")
        .select("cart,wishlist")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data: old, error }) => {
            if (error) throw error;

            const payload = {
                user_id: user.id,
                cart: old?.cart ?? userData("cart"),
                wishlist: old?.wishlist ?? userData("wishlist"),
                updated_at: new Date().toISOString()
            };

            payload[type] = data;

            return db
                .from("customer_state")
                .upsert(payload, { onConflict: "user_id" });
        })
        .then(({ error }) => {
            if (error) {
                console.warn(
                    "Could not sync customer state:",
                    error.message
                );
            }
        })
        .catch(error => {
            console.warn(
                "Could not sync customer state:",
                error.message
            );
        });
}

function mergeGuestShoppingData(email) {
    const normalizedEmail = String(email || "").toLowerCase();
    if (!normalizedEmail) return;

    ["cart", "wishlist"].forEach(type => {
        const guestKey = `kemolux_${type}_guest`;
        const accountKey = `kemolux_${type}_${normalizedEmail}`;
        const guestItems = read(guestKey, []);
        const accountItems = read(accountKey, []);

        if (guestItems.length) {
            const merged = [...accountItems];
            guestItems.forEach(guestItem => {
                const match = merged.find(item =>
                    String(item.id) === String(guestItem.id) &&
                    String(item.variation || "") === String(guestItem.variation || "")
                );
                if (match && type === "cart") {
                    match.qty = Number(match.qty || 1) + Number(guestItem.qty || 1);
                } else if (!match) {
                    merged.push(guestItem);
                }
            });
            write(accountKey, merged);
            localStorage.removeItem(guestKey);
        }
    });
}

function money(value) {
    return "₦" + Number(value || 0).toLocaleString("en-NG", {
        maximumFractionDigits: 2
    });
}

function safe(value = "") {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

/* =========================================================
   2. GENERAL SITE FUNCTIONS
========================================================= */

function categoryDisplay(category){
    const labels={shoes:"Footwear",glasses:"Glasses and Watches",cosmetics:"Cosmetics and Aesthetics",wig:"Wigs",clothing:"Clothing",jewelry:"Jewelry",bags:"Bags"};
    return labels[String(category||"").toLowerCase()]||String(category||"");
}

function closePopup() {
    const popup = document.getElementById("popupAd");

    if (popup) {
        popup.style.display = "none";
        sessionStorage.setItem("kemoluxPopupClosed", "1");
    }
}

function goToService() {
    location.href = "service.html";
}

function toggleMode() {
    const title = document.getElementById("auth-title");
    const button = document.getElementById("auth-btn");

    if (!title || !button) return;

    window.isLoginMode = !window.isLoginMode;

    const isLogin = window.isLoginMode;

    title.textContent = isLogin ? "Login" : "Sign Up";
    button.textContent = isLogin ? "Login" : "Join Now";

    const username = document.getElementById("username");
    const forgotLink = document.getElementById("forgot-link");
    const toggleMessage = document.getElementById("toggle-msg");
    const toggleLink = document.getElementById("toggle-link");

    if (username) username.style.display = isLogin ? "none" : "block";
    if (forgotLink) forgotLink.style.display = isLogin ? "block" : "none";

    if (toggleMessage) {
        toggleMessage.textContent = isLogin
            ? "New here?"
            : "Already have an account?";
    }

    if (toggleLink) {
        toggleLink.textContent = isLogin ? "Sign Up" : "Login";
    }
}

window.isLoginMode = false;

/* =========================================================
   3. AUTHENTICATION
========================================================= */

async function handleAuth() {
    const name = document.getElementById("username")?.value.trim();
    const email = document.getElementById("email")?.value.trim().toLowerCase();
    const password = document.getElementById("password")?.value;

    if (!email || !password) {
        return alert("Enter your email and password.");
    }

    if (SUPABASE_READY) {
        try {
            let result;

            if (window.isLoginMode) {
                result = await db.auth.signInWithPassword({
                    email,
                    password
                });

                if (result.error) throw result.error;
            } else {
                if (!name) {
                    return alert("Enter your full name.");
                }

                if (password.length < 6) {
                    return alert("Use at least 6 characters for your password.");
                }

                result = await db.auth.signUp({
                    email,
                    password,
                    options: {
                        data: { full_name: name },
                        emailRedirectTo:
                            location.origin +
                            location.pathname.replace(/[^/]*$/, "index.html")
                    }
                });

                if (result.error) throw result.error;

                if (!result.data.session) {
                    alert(
                        "Check your email to confirm your KÉMOLUX account, then log in."
                    );
                    return;
                }

                await db.from("profiles").upsert({
                    id: result.data.user.id,
                    full_name: name,
                    role: "customer"
                }, {
                    onConflict: "id"
                });
            }

            const user = result.data.user;

            if (!window.isLoginMode) {
                await db.from("profiles").upsert({
                    id: user.id,
                    full_name: name || user.user_metadata?.full_name || "",
                    email: user.email,
                    role: "customer"
                }, {
                    onConflict: "id"
                });
            }

            await db.from("login_history").insert({
                user_id: user.id,
                email,
                activity: window.isLoginMode ? "Login" : "Sign up"
            });

            write(STORE.active, {
                id: user.id,
                name: name || user.user_metadata?.full_name || email.split("@")[0],
                email
            });

            mergeGuestShoppingData(email);

            const { data: state } = await db
                .from("customer_state")
                .select("*")
                .eq("user_id", user.id)
                .maybeSingle();

            if (state) {
                const localCart = read(`kemolux_cart_${email}`, []);
                const localWishlist = read(`kemolux_wishlist_${email}`, []);
                const mergeItems = (saved, local, type) => {
                    const merged = [...(saved || [])];
                    (local || []).forEach(item => {
                        const match = merged.find(entry =>
                            String(entry.id) === String(item.id) &&
                            String(entry.variation || "") === String(item.variation || "")
                        );
                        if (match && type === "cart") match.qty = Number(match.qty || 1) + Number(item.qty || 1);
                        else if (!match) merged.push(item);
                    });
                    return merged;
                };
                write(`kemolux_cart_${email}`, mergeItems(state.cart, localCart, "cart"));
                write(`kemolux_wishlist_${email}`, mergeItems(state.wishlist, localWishlist, "wishlist"));
            }

            alert(
                window.isLoginMode
                    ? "Welcome back!"
                    : "Your account is ready."
            );

            const next = new URLSearchParams(location.search).get("next");
            location.href = next && !next.includes("://") ? next : "home.html";
            return;

        } catch (error) {
            alert(error.message || "Authentication failed. Please try again.");
            return;
        }
    }

    /* Browser-storage fallback */

    const users = read(STORE.users);
    let user;

    if (window.isLoginMode) {
        user = users.find(
            item => item.email === email && item.pass === password
        );

        if (!user) {
            return alert("Email or password is incorrect.");
        }
    } else {
        if (!name) return alert("Enter your full name.");

        if (password.length < 6) {
            return alert("Use at least 6 characters for your password.");
        }

        if (users.some(item => item.email === email)) {
            return alert("This email already has an account.");
        }

        user = {
            id: Date.now(),
            name,
            email,
            pass: password,
            createdAt: new Date().toISOString(),
            address: "",
            phone: ""
        };

        users.push(user);
        write(STORE.users, users);
    }

    write(STORE.active, {
        id: user.id,
        name: user.name,
        email: user.email
    });

    const logs = read(STORE.logins);

    logs.push({
        id: Date.now(),
        userId: user.id,
        name: user.name,
        email: user.email,
        action: window.isLoginMode ? "Login" : "Sign up",
        at: new Date().toISOString()
    });

    write(STORE.logins, logs);

    const customers = read(STORE.customers);

    if (!customers.some(customer => customer.email === email)) {
        customers.push({
            name: user.name,
            email,
            phone: user.phone || "",
            address: user.address || "",
            createdAt: user.createdAt || new Date().toISOString()
        });
    }

    write(STORE.customers, customers);

    alert(
        window.isLoginMode
            ? `Welcome back, ${user.name}!`
            : "Your KÉMOLUX account is ready."
    );

    mergeGuestShoppingData(email);
    const next = new URLSearchParams(location.search).get("next");
    location.href = next && !next.includes("://") ? next : "home.html";
}

async function forgotPassword() {
    const email = document.getElementById("email")?.value.trim().toLowerCase();

    if (SUPABASE_READY) {
        if (!email) {
            return alert("Enter your email address first.");
        }

        const { error } = await db.auth.resetPasswordForEmail(email, {
            redirectTo:
                location.origin +
                location.pathname.replace(/[^/]*$/, "reset-password.html")
        });

        if (error) return alert(error.message);

        alert("Password reset link sent. Check your inbox and spam folder.");
        return;
    }

    alert(
        "Add your Supabase project URL and anon key to supabase-config.js to enable secure password recovery."
    );
}

async function logout() {
    if (SUPABASE_READY) {
        const { error } = await db.auth.signOut();
        if (error) console.warn("Supabase sign-out warning:", error.message);
    }
    localStorage.removeItem(STORE.active);
    location.href = "home.html";
}

/* =========================================================
   4. PRODUCTS AND HEADER COUNTS
========================================================= */

function saveProducts() {
    write(STORE.products, products);
}

function updateCounts() {
    const cart = userData("cart");
    const wishlist = userData("wishlist");

    const cartCount = document.getElementById("cartCount");
    const wishlistCount = document.getElementById("wishCount");

    if (cartCount) {
        cartCount.textContent = cart.reduce(
            (total, item) => total + Number(item.qty || 1),
            0
        );
    }

    if (wishlistCount) {
        wishlistCount.textContent = wishlist.length;
    }
}

/* =========================================================
   5. ADMIN PRODUCT MANAGEMENT
========================================================= */

async function initAdmin() {
    const form=document.getElementById("productForm"); if(!form)return;
    if(!SUPABASE_READY || !db){
        const shell=document.querySelector(".admin-shell");
        if(shell)shell.innerHTML=`<section class="admin-panel"><h1>Supabase setup required</h1><p>Add your Supabase project URL and anon key to supabase-config.js before using staff tools.</p><a class="btn" href="home.html">Return to store</a></section>`;
        return;
    }
    const {data:{session}}=await db.auth.getSession();
    if(!session){location.href="login.html";return;}
    const {data:adminAccount,error:adminCheckError}=await db.from("admin_accounts").select("user_id").eq("user_id",session.user.id).eq("is_active",true).maybeSingle();
    if(adminCheckError || !adminAccount){document.querySelector(".admin-shell").innerHTML=`<section class="admin-panel"><h1>Admin access required</h1><p>This account is not authorised to manage KÉMOLUX.</p><button class="btn" onclick="logout()">Sign out</button></section>`;return;}
    const {data:cloudProducts,error}=await db.from("products").select("*").order("created_at",{ascending:false});
    if(error)alert("Could not load products: "+error.message);
    if(cloudProducts)products=cloudProducts.map(p=>({id:String(p.id),name:p.name,category:p.category,image:p.image_url||(p.image_urls||[])[0]||"images/logo.jpeg",imageUrls:p.image_urls||(p.image_url?[p.image_url]:[]),desc:p.description,qty:p.stock,price:Number(p.price),variations:p.variations||[]}));
    renderAdminProducts();renderCloudAdminRecords();
    form.addEventListener("submit",async event=>{
        event.preventDefault();
        const files=[...(document.getElementById("pImage").files||[])];if(!files.length)return alert("Choose at least one product image.");
        const name=document.getElementById("pName").value.trim();
        if(products.some(p=>p.name.toLowerCase()===name.toLowerCase()))return alert("A product with this name already exists. Use a unique product name.");
        try{
            const urls=[];
            for(const file of files){const ext=(file.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"");const path=`${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                const {data:uploaded,error:uploadError}=await db.storage.from("product-images").upload(path,file,{upsert:true,contentType:file.type});if(uploadError)throw uploadError;
                urls.push(db.storage.from("product-images").getPublicUrl(uploaded.path).data.publicUrl);}
            const variations=[...document.querySelectorAll(".variation-group")].flatMap(group=>{const type=group.querySelector(".vType")?.value||"Variation";return [...group.querySelectorAll(".variation-row")].map(row=>({type,option:row.querySelector(".vOption")?.value.trim(),price:Number(row.querySelector(".vPrice")?.value||0)})).filter(v=>v.option);});
            const payload={name,category:document.getElementById("pCategory").value,image_url:urls[0],image_urls:urls,description:document.getElementById("pDesc").value.trim(),stock:Number(document.getElementById("pQty").value||0),variations,price:Number(document.getElementById("pPrice").value||0),active:true};
            const {data:row,error:saveError}=await db.from("products").insert(payload).select().single();if(saveError)throw saveError;
            products.unshift({id:String(row.id),name,category:payload.category,image:urls[0],imageUrls:urls,desc:payload.description,qty:payload.stock,variations,price:payload.price});
            form.reset();renderAdminProducts();renderProducts();alert("Product published successfully.");
        }catch(err){alert("Could not publish product: "+err.message);}
    });
}

function addVariationOption(button) {
    const group = button.closest(".variation-group");
    const row = document.createElement("div");

    row.className = "variation-row";

    row.innerHTML = `
        <input type="text" placeholder="Option e.g. Black" class="vOption">
        <input type="number" placeholder="Extra price (₦)" class="vPrice" min="0" value="0">
        <button type="button" class="btn-danger" onclick="this.parentElement.remove()">
            Remove
        </button>
    `;

    group.insertBefore(row, button.closest(".variation-row").nextSibling);
}

function addVariationGroup() {
    const group = document.createElement("div");

    group.className = "variation-group";

    group.innerHTML = `
        <select class="vType">
            <option value="">Choose variation type</option>
            <option>Colour</option>
            <option>Size</option>
            <option>Length</option>
            <option>Material</option>
            <option>Style</option>
            <option>Capacity</option>
        </select>

        <div class="variation-row">
            <input type="text" placeholder="Option e.g. Medium" class="vOption">
            <input type="number" placeholder="Extra price (₦)" class="vPrice" min="0" value="0">
            <button type="button" class="btn-ghost" onclick="addVariationOption(this)">
                + Option
            </button>
        </div>

        <button type="button" class="btn-danger" onclick="this.parentElement.remove()">
            Remove type
        </button>
    `;

    document.getElementById("variations")?.appendChild(group);
}

function renderAdminProducts(){
 const wrapper=document.getElementById("adminProducts");if(!wrapper)return;
 wrapper.innerHTML=products.length?products.map(p=>`<article class="admin-product"><img src="${safe(p.image)}" alt="${safe(p.name)}"><div><b>${safe(p.name)}</b><p>${safe(p.category)} · ${money(p.price)}</p><small>Photos: ${(p.imageUrls||[p.image]).filter(Boolean).length} · Stock: ${Number(p.qty||0)}</small></div><div class="admin-product-actions"><button class="btn-ghost" onclick="editProduct('${safe(String(p.id))}')">Edit</button><button class="btn-danger" onclick="deleteProduct('${safe(String(p.id))}')">Delete</button></div></article>`).join(""):"<p>No products published yet.</p>";
}

function ensureProductEditModal(){
 let modal=document.getElementById("productEditModal");
 if(modal)return modal;
 modal=document.createElement("div");
 modal.id="productEditModal";
 modal.className="product-edit-overlay";
 modal.innerHTML=`
  <section class="product-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="productEditTitle">
   <div class="product-edit-heading"><h2 id="productEditTitle">Edit published product</h2><button type="button" class="product-edit-close" onclick="closeProductEditModal()">×</button></div>
   <form id="productEditForm">
    <div class="product-edit-layout">
     <div class="product-edit-fields">
      <label for="editProductName">Product name</label><input id="editProductName" required>
      <label for="editProductCategory">Category</label><select id="editProductCategory" required>
       <option value="wig">Wigs</option><option value="clothing">Clothing</option><option value="shoes">Footwear</option><option value="jewelry">Jewelry</option><option value="glasses">Glasses and Watches</option><option value="cosmetics">Cosmetics and Aesthetics</option><option value="bags">Bags</option>
      </select>
      <label for="editProductDescription">Description</label><textarea id="editProductDescription" rows="4"></textarea>
      <div class="product-edit-two"><div><label for="editProductPrice">Price (₦)</label><input id="editProductPrice" type="number" min="0" step="0.01" required></div><div><label for="editProductStock">Stock quantity</label><input id="editProductStock" type="number" min="0" step="1" required></div></div>
      <label for="editProductVariations">Variations (JSON)</label><textarea id="editProductVariations" rows="5" spellcheck="false"></textarea>
      <label for="editProductImages">Add product pictures</label><input id="editProductImages" type="file" accept="image/*" multiple>
      <p class="product-edit-hint">Uncheck any existing picture you want to remove. Newly selected pictures will be added.</p>
      <div id="editExistingImages" class="edit-existing-images"></div>
     </div>
     <aside class="product-live-preview"><h3>Product preview</h3><div id="editProductPreview"></div></aside>
    </div>
    <div class="product-edit-footer"><button type="button" class="btn-ghost" onclick="closeProductEditModal()">Cancel</button><button type="submit" class="btn">Save changes</button></div>
   </form>
  </section>`;
 document.body.appendChild(modal);
 modal.addEventListener("click",e=>{if(e.target===modal)closeProductEditModal();});
 document.getElementById("productEditForm").addEventListener("submit",saveEditedProduct);
 ["editProductName","editProductCategory","editProductDescription","editProductPrice","editProductStock","editProductVariations","editProductImages"].forEach(id=>{
  document.getElementById(id).addEventListener("input",renderProductEditPreview);
  document.getElementById(id).addEventListener("change",renderProductEditPreview);
 });
 return modal;
}
let editingProductId=null;
function closeProductEditModal(){
 const modal=document.getElementById("productEditModal");
 if(modal)modal.classList.remove("active");
 editingProductId=null;
}
function editProduct(id){
 const p=products.find(x=>String(x.id)===String(id));if(!p)return;
 editingProductId=String(id);
 ensureProductEditModal().classList.add("active");
 document.getElementById("editProductName").value=p.name||"";
 document.getElementById("editProductCategory").value=p.category||"wig";
 document.getElementById("editProductDescription").value=p.desc||"";
 document.getElementById("editProductPrice").value=Number(p.price||0);
 document.getElementById("editProductStock").value=Number(p.qty||0);
 document.getElementById("editProductVariations").value=JSON.stringify(p.variations||[],null,2);
 document.getElementById("editProductImages").value="";
 const urls=(p.imageUrls&&p.imageUrls.length?p.imageUrls:[p.image]).filter(Boolean);
 document.getElementById("editExistingImages").innerHTML=urls.map((url,i)=>`
  <label class="edit-image-choice"><input type="checkbox" checked data-existing-image="${i}"><img src="${safe(url)}" alt="Product image ${i+1}"><span>Keep picture ${i+1}</span></label>
 `).join("");
 renderProductEditPreview();
}
function renderProductEditPreview(){
 const preview=document.getElementById("editProductPreview");if(!preview)return;
 const name=document.getElementById("editProductName")?.value||"Product name";
 const category=document.getElementById("editProductCategory")?.selectedOptions?.[0]?.textContent||"Category";
 const desc=document.getElementById("editProductDescription")?.value||"";
 const price=Number(document.getElementById("editProductPrice")?.value||0);
 const p=products.find(x=>String(x.id)===String(editingProductId));
 const urls=(p?.imageUrls&&p.imageUrls.length?p.imageUrls:[p?.image]).filter(Boolean);
 const keep=[...document.querySelectorAll("[data-existing-image]:checked")].map(el=>urls[Number(el.dataset.existingImage)]).filter(Boolean);
 const added=[...(document.getElementById("editProductImages")?.files||[])].map(f=>URL.createObjectURL(f));
 const images=[...keep,...added];
 preview.innerHTML=`<div class="edit-preview-card"><div class="edit-preview-images">${images.length?images.map(url=>`<img src="${safe(url)}" alt="Preview image">`).join(""):'<div class="edit-preview-placeholder">Product pictures will appear here</div>'}</div><div class="edit-preview-copy"><small>${safe(category)}</small><h4>${safe(name)}</h4><strong>${money(price)}</strong><p>${safe(desc)}</p></div></div>`;
}
async function saveEditedProduct(event){
 event.preventDefault();
 const p=products.find(x=>String(x.id)===String(editingProductId));if(!p)return;
 const name=document.getElementById("editProductName").value.trim();
 if(!name)return alert("Product name is required.");
 if(products.some(x=>String(x.id)!==String(editingProductId)&&String(x.name).toLowerCase()===name.toLowerCase()))return alert("Another product already uses this name.");
 const category=document.getElementById("editProductCategory").value;
 const price=Number(document.getElementById("editProductPrice").value);
 const qty=Number(document.getElementById("editProductStock").value);
 if(!Number.isFinite(price)||price<0||!Number.isInteger(qty)||qty<0)return alert("Enter a valid price and stock quantity.");
 let variations;
 try{variations=JSON.parse(document.getElementById("editProductVariations").value||"[]");if(!Array.isArray(variations))throw new Error("Variations must be an array.");}
 catch(err){return alert("Please check the variations JSON: "+err.message);}
 const oldUrls=(p.imageUrls&&p.imageUrls.length?p.imageUrls:[p.image]).filter(Boolean);
 let urls=[...document.querySelectorAll("[data-existing-image]:checked")].map(el=>oldUrls[Number(el.dataset.existingImage)]).filter(Boolean);
 const files=[...(document.getElementById("editProductImages").files||[])];
 try{
  for(const file of files){
   const ext=(file.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"");
   const path=`${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
   const {data,error}=await db.storage.from("product-images").upload(path,file,{upsert:true,contentType:file.type});
   if(error)throw error;
   urls.push(db.storage.from("product-images").getPublicUrl(data.path).data.publicUrl);
  }
  if(!urls.length)return alert("Keep or add at least one product picture.");
  const updates={name,category,description:document.getElementById("editProductDescription").value.trim(),price,stock:qty,variations,image_url:urls[0],image_urls:urls};
  const {error}=await db.from("products").update(updates).eq("id",editingProductId);
  if(error)throw error;
  Object.assign(p,{name,category,desc:updates.description,price,qty,variations,image:urls[0],imageUrls:urls});
  renderAdminProducts();renderProducts();closeProductEditModal();
 }catch(err){alert("Could not update product: "+(err.message||err));}
}

function deleteProduct(id) {
    const productId = String(id);

    if (!confirm("Remove this product from the collection?")) return;

    if (SUPABASE_READY) {
        db.from("products")
            .delete()
            .eq("id", productId)
            .then(({ error }) => {
                if (error) alert(error.message);
            });
    }

    products = products.filter(
        product => String(product.id) !== productId
    );

    saveProducts();
    renderAdminProducts();
    renderProducts();
}

function filterProducts(category, button) {
    currentFilter = category;

    document.querySelectorAll(".filter-btn").forEach(item => {
        item.classList.toggle("active", item.dataset.category === category);
    });

    const label = document.getElementById("activeCategoryLabel");
    if (label) {
        const selected = document.querySelector(`.filter-btn[data-category="${category}"]`);
        label.textContent = category === "all" ? "All Categories" : (selected?.textContent.trim() || category);
    }

    const menu = document.getElementById("categoryMenu");
    const toggle = document.getElementById("categoryToggle");
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");

    renderProducts();
}

function setCollectionSearch(value) {
    collectionSearchTerm = String(value || "").trim().toLowerCase();
    renderProducts();
}

/* =========================================================
   6. COLLECTION PAGE
========================================================= */

async function initCollection() {
    const grid = document.getElementById("productGrid");

    if (!grid) return;

    if (SUPABASE_READY) {
        grid.innerHTML =
            '<p class="collection-status">Loading KÉMOLUX collection…</p>';

        const { data, error } = await db
            .from("products")
            .select("*")
            .eq("active", true)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("KÉMOLUX collection load failed:", error);

            grid.innerHTML = `
                <div class="empty-state">
                    <h3>We could not load the collection</h3>
                    <p>${safe(error.message)}</p>
                    <button class="btn" onclick="initCollection()">Try again</button>
                </div>
            `;

            return;
        }

        products = (data || []).map(product => ({
            id: String(product.id),
            name: product.name,
            category: product.category,
            image: product.image_url || (product.image_urls || [])[0] || "images/logo.jpeg",
            imageUrls: product.image_urls || (product.image_url ? [product.image_url] : []),
            desc: product.description || "",
            qty: Number(product.stock || 0),
            price: Number(product.price || 0),
            variations: product.variations || []
        }));

        saveProducts();

    } else {
        console.warn(
            "Not configured; showing products saved in this browser only."
        );
    }

    const searchInput = document.getElementById("collectionSearch");
    const clearSearch = document.getElementById("clearCollectionSearch");
    if (searchInput) searchInput.addEventListener("input", event => setCollectionSearch(event.target.value));
    if (clearSearch) clearSearch.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        setCollectionSearch("");
        searchInput?.focus();
    });

    const categoryToggle = document.getElementById("categoryToggle");
    const categoryMenu = document.getElementById("categoryMenu");
    const closeCategoryMenu = document.getElementById("closeCategoryMenu");
    if (categoryToggle && categoryMenu && !categoryToggle.dataset.bound) {
        categoryToggle.dataset.bound = "true";
        categoryToggle.addEventListener("click", () => {
            categoryMenu.hidden = !categoryMenu.hidden;
            categoryToggle.setAttribute("aria-expanded", String(!categoryMenu.hidden));
        });
    }
    if (closeCategoryMenu && categoryMenu && !closeCategoryMenu.dataset.bound) {
        closeCategoryMenu.dataset.bound = "true";
        closeCategoryMenu.addEventListener("click", () => {
            categoryMenu.hidden = true;
            categoryToggle?.setAttribute("aria-expanded", "false");
        });
    }

    renderProducts();
}

function productCard(product) {
    const id = safe(String(product.id));

    return `
        <article class="card">
            <img
                class="product-image"
                src="${safe(product.image)}"
                alt="${safe(product.name)}"
                onclick="openModal('${id}')"
                loading="lazy"
            >

            <div class="card-body">
                <h3 onclick="openModal('${id}')" style="cursor:pointer">${safe(product.name)}</h3>
                <p class="category-label">${safe(categoryDisplay(product.category))}</p>
                <p class="price">${money(product.price)}</p>

                <div class="product-actions">
                    <button class="product-icon-btn cart-action" type="button" onclick="addToCart('${id}')" aria-label="Add ${safe(product.name)} to cart" title="Add to cart">
                        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>
                    </button>
                    <button class="product-icon-btn" type="button" onclick="toggleWish('${id}')" aria-label="Add ${safe(product.name)} to wishlist" title="Add to wishlist">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>
                    </button>
                </div>
            </div>
        </article>
    `;
}

function renderProducts() {
    const wrapper = document.getElementById("productGrid");

    if (!wrapper) return;

    const filteredProducts = products.filter(product => {
        const productCategory = String(product.category || "").toLowerCase().trim().replace(/s$/, "");
        const selectedCategory = String(currentFilter || "all").toLowerCase().trim().replace(/s$/, "");
        const categoryMatch = currentFilter === "all" || productCategory === selectedCategory;
        const searchableText = [product.name, product.category, product.desc].join(" ").toLowerCase();
        return categoryMatch && (!collectionSearchTerm || searchableText.includes(collectionSearchTerm));
    });

    const status = document.getElementById("collectionSearchStatus");
    if (status) status.textContent = collectionSearchTerm
        ? `${filteredProducts.length} result${filteredProducts.length === 1 ? "" : "s"} for “${collectionSearchTerm}”`
        : "";

    wrapper.innerHTML = filteredProducts.length
        ? filteredProducts.map(productCard).join("")
        : `
            <div class="empty-state">
                <h3>${collectionSearchTerm ? "No matching products found" : "Our collection is being prepared"}</h3>
                <p>${collectionSearchTerm ? "Try another product name or category." : "New KÉMOLUX pieces will appear here soon."}</p>
            </div>
        `;
}

/* =========================================================
   7. PRODUCT MODAL AND VARIATIONS
========================================================= */

function openModal(id) {
    const productId = String(id);

    const product = products.find(
        item => String(item.id) === productId
    );

    const modal = document.getElementById("productModal");
    const body = document.getElementById("modalBody");

    if (!product || !modal || !body) {
        console.warn("Product modal could not open.", {
            productId,
            productFound: !!product,
            modalFound: !!modal,
            bodyFound: !!body
        });

        return;
    }

    const variations = product.variations || [];

    const groups = [
        ...new Set(
            variations.map(
                variation => variation.type || product.vType || "Variation"
            )
        )
    ];

    const controls = groups.map((type, groupIndex) => {
        const options = variations
            .map((variation, index) => ({
                ...variation,
                _index: index
            }))
            .filter(variation =>
                (variation.type || product.vType || "Variation") === type
            );

        return `
            <div class="variation-group">
                <label for="modalVar${groupIndex}">${safe(type)}</label>

                <select
                    class="modalVar"
                    id="modalVar${groupIndex}"
                    data-type="${safe(type)}"
                    onchange="updateModalPrice('${safe(productId)}')"
                >
                    <option value="">Choose ${safe(type.toLowerCase())}</option>

                    ${options.map(option => `
                        <option value="${option._index}">
                            ${safe(option.option)}
                            ${option.price ? ` (+${money(option.price)})` : ""}
                        </option>
                    `).join("")}
                </select>
            </div>
        `;
    }).join("");

    currentProductImageIndex = 0;
    body.innerHTML = `
        <button
            class="modal-close"
            onclick="document.getElementById('productModal').classList.remove('active')"
        >
            ×
        </button>

        <div class="product-image-slider" data-image-index="0">
            <button type="button" class="image-slider-arrow image-slider-prev" aria-label="Previous image" onclick="slideProductImage(-1)">‹</button>
            <div class="product-image-viewport"><div class="product-image-track" id="productImageTrack">
                ${(product.imageUrls && product.imageUrls.length ? product.imageUrls : [product.image]).filter(Boolean).map((url,index)=>`<img src="${safe(url)}" alt="${safe(product.name)} view ${index+1}" class="product-slide" loading="${index===0?'eager':'lazy'}">`).join("")}
            </div></div>
            <button type="button" class="image-slider-arrow image-slider-next" aria-label="Next image" onclick="slideProductImage(1)">›</button>
        </div>
        <div class="product-image-dots" id="productImageDots">${(product.imageUrls && product.imageUrls.length ? product.imageUrls : [product.image]).filter(Boolean).map((_,index)=>`<button type="button" class="product-image-dot ${index===0?'active':''}" aria-label="Show image ${index+1}" onclick="slideProductImage(${index},true)"></button>`).join("")}</div>

        <h2>${safe(product.name)}</h2>

        <p id="modalPrice" class="price">${money(product.price)}</p>

        <p>${safe(product.desc || "")}</p>

        ${controls}

        <label for="modalQty">Quantity</label>

        <input
            id="modalQty"
            type="number"
            min="1"
            max="${Math.max(1, Number(product.qty || 1))}"
            value="1"
        >

        <button class="btn" onclick="addToCartFromModal('${safe(productId)}')">
            Add to Cart
        </button>

        <button class="btn-ghost" onclick="toggleWish('${safe(productId)}')">
            ♡ Save to Wishlist
        </button>
    `;

    const imageViewport = body.querySelector(".product-image-viewport");
    const imageCount = body.querySelectorAll(".product-slide").length;
    const arrows = body.querySelectorAll(".image-slider-arrow");
    const dots = body.querySelector("#productImageDots");
    if (imageCount <= 1) {
        arrows.forEach(button => button.hidden = true);
        if (dots) dots.hidden = true;
    }
    if (imageViewport && imageCount > 1) {
        let touchStartX = 0;
        imageViewport.addEventListener("touchstart", event => {
            touchStartX = event.changedTouches[0].screenX;
        }, { passive: true });
        imageViewport.addEventListener("touchend", event => {
            const delta = event.changedTouches[0].screenX - touchStartX;
            if (Math.abs(delta) > 35) slideProductImage(delta < 0 ? 1 : -1);
        }, { passive: true });
    }
    modal.classList.add("active");
}

let currentProductImageIndex = 0;
function slideProductImage(direction, jumpToIndex = false) {
    const track = document.getElementById("productImageTrack");
    const dots = [...document.querySelectorAll("#productImageDots .product-image-dot")];
    if (!track) return;
    const count = track.children.length;
    if (!count) return;
    currentProductImageIndex = jumpToIndex
        ? Math.max(0, Math.min(count - 1, Number(direction)))
        : (currentProductImageIndex + Number(direction) + count) % count;
    track.style.transform = `translateX(-${currentProductImageIndex * 100}%)`;
    dots.forEach((dot, index) => dot.classList.toggle("active", index === currentProductImageIndex));
}

function selectedVariations(product) {
    return [
        ...document.querySelectorAll("#modalBody .modalVar")
    ].map(element => {
        const variation = product.variations?.[Number(element.value)];

        if (element.value !== "" && variation) {
            return {
                type: variation.type || product.vType || "Variation",
                option: variation.option,
                price: Number(variation.price || 0)
            };
        }

        return null;
    }).filter(Boolean);
}

function updateModalPrice(id) {
    const productId = String(id);

    const product = products.find(
        item => String(item.id) === productId
    );

    if (!product) return;

    const selected = selectedVariations(product);

    const total = Number(product.price || 0) +
        selected.reduce((sum, variation) => sum + variation.price, 0);

    const priceElement = document.getElementById("modalPrice");

    if (priceElement) {
        priceElement.textContent = money(total);
    }
}

function closeModal(event) {
    if (event.target.id === "productModal") {
        event.currentTarget.classList.remove("active");
    }
}

/* =========================================================
   8. CART — FIXED
========================================================= */


function addToCart(id) {
    const productId = String(id);

    // First look in the loaded products.
    let product = products.find(
        item => String(item.id) === productId
    );

    // If it is not there, look in the saved wishlist.
    if (!product) {
        const savedItem = userData("wishlist").find(
            item => String(item.id) === productId
        );

        if (savedItem) {
            product = {
                ...savedItem,
                id: productId,
                qty: Number(savedItem.qty ?? 1),
                variations: savedItem.variations || [],
                desc: savedItem.desc || ""
            };

            // Make it available to the product modal.
            products.push(product);
        }
    }

    if (!product) {
        console.warn("Product not found:", productId);
        return alert(
            "This product could not be found. Please refresh the page and try again."
        );
    }

    // Older wishlist entries may not contain stock information.
    const stock = Number(product.qty ?? 1);

    if (stock < 1) {
        return alert("Sorry, this product is currently out of stock.");
    }

    // Products with variations must go through the selection modal.
    if ((product.variations || []).length > 0) {
        openModal(productId);
        return;
    }

    const cart = userData("cart");

    const existingItem = cart.find(item =>
        String(item.id) === productId &&
        !item.variation
    );

    if (existingItem) {
        if (Number(existingItem.qty || 1) >= stock) {
            return alert("You have reached the available stock for this product.");
        }

        existingItem.qty = Number(existingItem.qty || 1) + 1;
    } else {
        cart.push({
            id: productId,
            name: product.name,
            price: Number(product.price || 0),
            image: product.image || "images/logo.jpeg",
            qty: 1,
            variation: "",
            variations: product.variations || []
        });
    }

    setUserData("cart", cart);
    updateCounts();

    if (document.getElementById("cartItems")) {
        renderCart();
    }

    alert(`${product.name} added to your cart.`);
}



function addToCartFromModal(id) {
    const productId = String(id);

    const product = products.find(
        item => String(item.id) === productId
    );

    if (!product) {
        console.error("Modal Add to Cart failed: product not found.", productId);
        return alert("This product could not be found. Please refresh the collection.");
    }

    const stock = Number(product.qty ?? 0);

    if (stock < 1) {
        return alert("Sorry, this product is currently out of stock.");
    }

    // Read the quantity selected in the product modal.
    const quantityInput = document.getElementById("modalQty");
    const quantity = Number(quantityInput?.value || 1);

    if (!Number.isInteger(quantity) || quantity < 1) {
        return alert("Please enter a valid quantity.");
    }

    if (quantity > stock) {
        return alert(`Only ${stock} item(s) are available in stock.`);
    }

    // Read the variation selections made by the customer.
    const variationSelects = [
        ...document.querySelectorAll("#modalBody .modalVar")
    ];

    const missingVariation = variationSelects.some(
        select => select.value === ""
    );

    if (missingVariation) {
        return alert("Please select all product options before adding to cart.");
    }

    const selected = selectedVariations(product);

    if (variationSelects.length && selected.length !== variationSelects.length) {
        return alert("Please select valid product options and try again.");
    }

    // Calculate the final unit price, including variation charges.
    const unitPrice =
        Number(product.price || 0) +
        selected.reduce(
            (sum, variation) => sum + Number(variation.price || 0),
            0
        );

    // Create a readable variation label for the cart.
    const variationLabel = selected
        .map(variation => `${variation.type}: ${variation.option}`)
        .join(", ");

    const cart = userData("cart");

    // Treat different variations of the same product as separate cart items.
    const existingItem = cart.find(item =>
        String(item.id) === productId &&
        String(item.variation || "") === variationLabel
    );

    if (existingItem) {
        const newQuantity = Number(existingItem.qty || 1) + quantity;

        if (newQuantity > stock) {
            return alert(
                `You can only add ${stock} item(s) of this product in this variation.`
            );
        }

        existingItem.qty = newQuantity;
        existingItem.price = unitPrice;
        existingItem.selectedVariations = selected;
    } else {
        cart.push({
            id: productId,
            name: product.name,
            price: unitPrice,
            image: product.image || "images/logo.jpeg",
            qty: quantity,
            variation: variationLabel,
            selectedVariations: selected,
            variations: product.variations || []
        });
    }

    setUserData("cart", cart);
    updateCounts();

    // Refresh the cart immediately if the cart page is open.
    if (document.getElementById("cartItems")) {
        renderCart();
    }

    // Close the product modal after adding successfully.
    const modal = document.getElementById("productModal");

    if (modal) {
        modal.classList.remove("active");
    }

    alert(`${product.name} added to your cart.`);
}


async function ensureCheckoutAccess() {
    if (!document.getElementById("shipping-form")) return;

    if (SUPABASE_READY) {
        try {
            const { data, error } = await db.auth.getSession();
            if (error) throw error;
            const sessionUser = data.session?.user;
            if (!sessionUser) {
                location.replace(`auth.html?next=${encodeURIComponent("shipping.html")}`);
                return;
            }
            write(STORE.active, {
                id: sessionUser.id,
                name: sessionUser.user_metadata?.full_name || sessionUser.email?.split("@")[0],
                email: sessionUser.email
            });
            mergeGuestShoppingData(sessionUser.email);
        } catch (error) {
            console.error("Could not verify checkout session:", error);
            alert("We could not verify your login. Please try signing in again.");
            location.replace(`auth.html?next=${encodeURIComponent("shipping.html")}`);
            return;
        }
    } else if (!activeUser()) {
        location.replace(`auth.html?next=${encodeURIComponent("shipping.html")}`);
        return;
    }

    const cart = userData("cart");
    const summary = document.getElementById("checkoutSummary");
    if (summary && cart.length) {
        const total = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1), 0);
        summary.innerHTML = cart.map(item => `<p>${safe(item.name)} ${item.variation ? `— ${safe(item.variation)}` : ""} × ${Number(item.qty || 1)} <strong style="float:right">${money(Number(item.price || 0) * Number(item.qty || 1))}</strong></p>`).join("") + `<hr><h3>Total: ${money(total)}</h3>`;
    }
    if (!cart.length) {
        if (summary) summary.innerHTML = '<p>Your cart is empty. <a href="collection.html">Browse collection</a>.</p>';
        const submit = document.querySelector('#shipping-form button[type="submit"]');
        if (submit) submit.disabled = true;
    }
}

function initCart() {
    if (document.getElementById("cartItems")) {
        renderCart();
    }
}

function renderCart() {
    const wrapper = document.getElementById("cartItems");
    if (!wrapper) return;

    const cart = userData("cart");
    let total = 0;

    wrapper.innerHTML = cart.length
        ? `
            <div class="shopping-card-grid cart-card-grid">
                ${cart.map((item, index) => {
                    const quantity = Number(item.qty || 1);
                    const price = Number(item.price || 0);
                    const subtotal = price * quantity;
                    total += subtotal;

                    return `
                        <article class="shopping-card cart-shopping-card">
                            <img class="shopping-card-image" src="${safe(item.image)}" alt="${safe(item.name)}">
                            <div class="shopping-card-body">
                                <h3>${safe(item.name)}</h3>
                                ${item.variation ? `<p class="shopping-card-variation">${safe(item.variation)}</p>` : ""}
                                <p class="price">${money(price)} each</p>
                                <strong class="shopping-card-subtotal">${money(subtotal)}</strong>
                                <div class="shopping-card-actions">
                                    <div class="qty-control compact-qty-control">
                                        <button type="button" aria-label="Decrease quantity" onclick="changeQty(${index}, -1)">−</button>
                                        <span>${quantity}</span>
                                        <button type="button" aria-label="Increase quantity" onclick="changeQty(${index}, 1)">+</button>
                                    </div>
                                    <button type="button" class="btn-danger compact-remove-btn" onclick="removeCart(${index})" aria-label="Remove ${safe(item.name)} from cart">Remove</button>
                                </div>
                            </div>
                        </article>
                    `;
                }).join("")}
            </div>
        `
        : `
            <div class="empty-state">
                <h3>Your cart is waiting</h3>
                <p>Add something lovely from the collection.</p>
                <a class="btn" href="collection.html">Explore collection</a>
            </div>
        `;

    const totalElement = document.getElementById("cartTotal");
    if (totalElement) totalElement.textContent = `Total: ${money(total)}`;

    const checkoutLink = document.getElementById("checkoutLink");
    if (checkoutLink) checkoutLink.href = cart.length ? "shipping.html" : "collection.html";
}

function changeQty(index, difference) {
    const cart = userData("cart");

    if (!cart[index]) return;

    cart[index].qty = Number(cart[index].qty || 1) + difference;

    if (cart[index].qty < 1) {
        cart.splice(index, 1);
    }

    setUserData("cart", cart);

    renderCart();
    updateCounts();
}

function removeCart(index) {
    const cart = userData("cart");

    if (!cart[index]) return;

    cart.splice(index, 1);

    setUserData("cart", cart);

    renderCart();
    updateCounts();
}

/* =========================================================
   9. WISHLIST — FIXED
========================================================= */


function toggleWish(id) {
    const productId = String(id);

    const product = products.find(
        item => String(item.id) === productId
    );

    if (!product) {
        console.warn("Wishlist product not found:", productId);
        return alert(
            "This product could not be found. Please refresh the collection and try again."
        );
    }

    const wishlist = userData("wishlist");

    const existingIndex = wishlist.findIndex(
        item => String(item.id) === productId
    );

    if (existingIndex >= 0) {
        wishlist.splice(existingIndex, 1);
        alert(`${product.name} removed from your wishlist.`);
    } else {
        // Save the complete product details, including variations and stock.
        wishlist.push({
            ...product,
            id: productId,
            price: Number(product.price || 0),
            qty: Number(product.qty ?? 1),
            variations: product.variations || []
        });

        alert(`${product.name} added to your wishlist.`);
    }

    setUserData("wishlist", wishlist);
    updateCounts();

    if (document.getElementById("wishItems")) {
        renderWishlist();
    }
}


function initWishlist() {
    if (document.getElementById("wishItems")) {
        renderWishlist();
    }
}

function renderWishlist() {
    const wrapper = document.getElementById("wishItems");
    if (!wrapper) return;

    const wishlist = userData("wishlist");

    wrapper.innerHTML = wishlist.length
        ? `
            <div class="shopping-card-grid wishlist-card-grid">
                ${wishlist.map(product => {
                    const id = safe(String(product.id));
                    return `
                        <article class="shopping-card wishlist-shopping-card">
                            <img class="shopping-card-image" src="${safe(product.image)}" alt="${safe(product.name)}" onclick="openModal('${id}')">
                            <div class="shopping-card-body">
                                <h3 onclick="openModal('${id}')">${safe(product.name)}</h3>
                                <p class="price">${money(product.price)}</p>
                                <div class="shopping-card-actions wishlist-actions">
                                    <button type="button" class="btn compact-action-btn" onclick="addToCart('${id}')" aria-label="Add ${safe(product.name)} to cart" title="Add to cart">🛒</button>
                                    <button type="button" class="btn-danger compact-action-btn" onclick="toggleWish('${id}')" aria-label="Remove ${safe(product.name)} from wishlist" title="Remove from wishlist">♥</button>
                                </div>
                            </div>
                        </article>
                    `;
                }).join("")}
            </div>
        `
        : `
            <div class="empty-state">
                <h3>Your wishlist is empty</h3>
                <p>Save pieces you love and find them here later.</p>
                <a class="btn" href="collection.html">Browse collection</a>
            </div>
        `;
}

/* =========================================================
   10. SHIPPING AND ORDER SUBMISSION
========================================================= */



async function submitShipping(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const originalText = button?.textContent;

    if (button) {
        button.disabled = true;
        button.textContent = "SUBMITTING ORDER...";
    }

    try {
        // Get the currently logged-in customer.
        const localUser = activeUser();
        let customer = localUser;

        // Verify the actual Supabase authentication session.
        if (SUPABASE_READY) {
            const {
                data: { user: authUser },
                error: authError
            } = await db.auth.getUser();

            if (authError) throw authError;

            if (!authUser) {
                throw new Error(
                    "Your login session has expired. Please log in again."
                );
            }

            // Always use the authenticated Supabase ID.
            customer = {
                id: authUser.id,
                name:
                    authUser.user_metadata?.full_name ||
                    localUser?.name ||
                    authUser.email?.split("@")[0],
                email: authUser.email
            };

            console.log("Verified customer:", customer);
        }

        if (!customer) {
            throw new Error("Please log in before placing an order.");
        }

        const formData = new FormData(form);
        const cart = userData("cart");

        if (!cart.length) {
            throw new Error("Your cart is empty.");
        }

        const order = {
            customer: customer.name,
            email: customer.email,
            phone: String(formData.get("phone") || "").trim(),
            address: String(formData.get("address") || "").trim(),
            city: String(formData.get("city") || "").trim(),
            state: String(formData.get("state") || "").trim(),
            notes: String(formData.get("notes") || "").trim(),
            items: cart,
            total: cart.reduce(
                (sum, item) =>
                    sum +
                    Number(item.price || 0) *
                    Number(item.qty || 1),
                0
            )
        };

        // Save the order to Supabase.
        if (SUPABASE_READY) {
            const payload = {
                user_id: customer.id,
                customer_name: order.customer,
                email: order.email,
                phone: order.phone,
                address: order.address,
                city: order.city,
                state: order.state,
                delivery_notes: order.notes,
                items: order.items,
                total: order.total,
                payment_status: "Unpaid",
                order_status: "Pending"
            };

            console.log("Submitting order:", payload);

            const {
                data: savedOrder,
                error: orderError
            } = await db
                .from("orders")
                .insert(payload)
                .select()
                .single();

            if (orderError) throw orderError;

            console.log(
                "KÉMOLUX order saved successfully:",
                savedOrder
            );

            // Update existing customer profile without changing its role.
            const { error: profileError } = await db
                .from("profiles")
                .update({
                    full_name: order.customer,
                    email: order.email,
                    phone: order.phone,
                    address: order.address,
                    city: order.city,
                    state: order.state
                })
                .eq("id", customer.id);

            if (profileError) {
                console.warn(
                    "Profile update warning:",
                    profileError.message
                );
            }

        } else {
            // Browser-storage fallback.
            const localOrder = {
                ...order,
                id: "KX-" + Date.now(),
                status: "Pending",
                paid: "Unpaid",
                createdAt: new Date().toISOString()
            };

            const orders = read(STORE.orders);
            orders.push(localOrder);
            write(STORE.orders, orders);
        }

        // Send a new-order email alert through Formspree.
        try {
            const notice=new FormData();
            notice.append("subject","New KÉMOLUX order placed");
            notice.append("Customer",order.customer);notice.append("Email",order.email);notice.append("Phone",order.phone);
            notice.append("Delivery address",[order.address,order.city,order.state].join(", "));
            notice.append("Items",order.items.map(i=>`${i.name} x ${i.qty}`).join("\n"));
            notice.append("Total",money(order.total));notice.append("Payment status","Unpaid");
            const response=await fetch("https://formspree.io/f/xaqvqeje",{method:"POST",body:notice,headers:{Accept:"application/json"}});
            if(!response.ok)console.warn("Formspree order alert was not accepted.");
        } catch(notificationError){console.warn("Order saved, but email notification failed.",notificationError);}
        // Update local customer information.
        const customers = read(STORE.customers);

        const customerIndex = customers.findIndex(
            item => item.email === customer.email
        );

        const customerProfile = {
            name: order.customer,
            email: order.email,
            phone: order.phone,
            address: order.address,
            city: order.city,
            state: order.state,
            updatedAt: new Date().toISOString()
        };

        if (customerIndex >= 0) {
            customers[customerIndex] = {
                ...customers[customerIndex],
                ...customerProfile
            };
        } else {
            customers.push(customerProfile);
        }

        write(STORE.customers, customers);

        // Clear the cart ONLY after successful order submission.
        setUserData("cart", []);
        updateCounts();

        alert(
            "Your order has been submitted successfully! KÉMOLUX will contact you to confirm payment and delivery."
        );

        location.href = "home.html";

    } catch (error) {
        console.error(
            "KÉMOLUX checkout error:",
            error
        );

        alert(
            "Your order could not be saved. Your cart has been preserved.\n\nError: " +
            (error.message || "Unknown error")
        );

        if (button) {
            button.disabled = false;
            button.textContent = originalText || "Place order";
        }
    }
}



/* =========================================================
   11. ADMIN RECORDS
========================================================= */
/* Login-history date filtering uses the visitor's local calendar day and Monday-start week. */
let cloudLoginHistory = [];
let cloudLoginHistoryLoaded = false;
function filteredLoginHistory(logs) {
    const period = document.getElementById("recordPeriod")?.value || "all";
    if (period === "all") return logs;
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return logs.filter(item => {
        const stamp = item.created_at || item.at || item.createdAt;
        const date = new Date(stamp);
        return !Number.isNaN(date.getTime()) && date >= start && date <= now;
    });
}
function paintLoginHistory(logs) {
    const tbody = document.getElementById("loginRecords");
    if (!tbody) return;
    const filtered = filteredLoginHistory(logs || []);
    tbody.innerHTML = filtered.length ? filtered.map(item => {
        const stamp = item.created_at || item.at || item.createdAt;
        return `<tr><td>${new Date(stamp).toLocaleString()}</td><td>${safe(item.name || item.full_name || item.email || "—")}</td><td>${safe(item.email || "—")}</td><td>${safe(item.activity || item.action || "Login")}</td></tr>`;
    }).join("") : '<tr><td colspan="4">No login activity for this period.</td></tr>';
    const summary = document.getElementById("recordSummary");
    if (summary) summary.textContent = `${filtered.length} login record${filtered.length === 1 ? "" : "s"} shown (${logs.length} total)`;
}
function applyLoginHistoryFilter() {
    if (cloudLoginHistoryLoaded) paintLoginHistory(cloudLoginHistory);
    else paintLoginHistory(read(STORE.logins));
}


function renderAdminRecords() {
    const orders = read(STORE.orders);
    const customers = read(STORE.customers);
    const logs = read(STORE.logins);
    const applications = read(STORE.applications);
    const appointments = read(STORE.appointments);

    const byId = id => document.getElementById(id);

    paintLoginHistory(logs);

    if (byId("customerRecords")) {
        byId("customerRecords").innerHTML = customers.length
            ? customers.map(customer => `
                <tr>
                    <td>${safe(customer.name)}</td>
                    <td>${safe(customer.email)}</td>
                    <td>${safe(customer.phone || "—")}</td>
                    <td>${safe(
                        [customer.address, customer.city, customer.state]
                            .filter(Boolean)
                            .join(", ") || "Not supplied"
                    )}</td>
                </tr>
            `).join("")
            : '<tr><td colspan="4">No customer records yet.</td></tr>';
    }

    renderOrderDashboard(orders);

    if (byId("appointmentRecords")) {
        byId("appointmentRecords").innerHTML = appointments.length
            ? appointments.slice().reverse().map(item => `
                <tr>
                    <td>${new Date(item.createdAt).toLocaleString()}</td>
                    <td>
                        ${safe(item.name)}
                        <small>${safe(item.email)} · ${safe(item.phone)}</small>
                    </td>
                    <td>${safe(item.service)} · ${safe(item.serviceType || "")}</td>
                    <td>
                        ${safe(item.date || "—")}
                        <small>${safe(item.address || "")}</small>
                    </td>
                    <td>${safe(item.status || "New")}</td>
                </tr>
            `).join("")
            : '<tr><td colspan="5">No appointments yet.</td></tr>';
    }

    if (byId("applicationRecords")) {
        byId("applicationRecords").innerHTML = applications.length
            ? applications.slice().reverse().map(item => `
                <tr>
                    <td>${new Date(item.createdAt).toLocaleString()}</td>
                    <td>${safe(item.name)}</td>
                    <td>${safe(item.email)} · ${safe(item.phone)}</td>
                    <td>${safe(item.experience)}</td>
                    <td>${safe(item.status || "New")}</td>
                </tr>
            `).join("")
            : '<tr><td colspan="5">No applications yet.</td></tr>';
    }

    const summary = byId("recordSummary");
    if (summary) {
        const filteredLogs = filteredLoginHistory(logs);
        summary.textContent = `${filteredLogs.length} login records · ${orders.length} orders · ${customers.length} customers · ${appointments.length} appointments · ${applications.length} applications`;
    }
}


let currentAdminOrders=[];
function orderGroupStatus(o){if(String(o.paid||"Unpaid").toLowerCase()==="unpaid")return "Unpaid order";if(String(o.status||"").toLowerCase()==="completed")return "Completed";if(String(o.status||"").toLowerCase()==="processing")return "Processing";return "Paid";}
function renderOrderDashboard(orders){
 currentAdminOrders=orders||[];const paid=currentAdminOrders.filter(o=>String(o.paid).toLowerCase()==="paid").reduce((s,o)=>s+Number(o.total||0),0);const unpaid=currentAdminOrders.filter(o=>String(o.paid).toLowerCase()!=="paid").reduce((s,o)=>s+Number(o.total||0),0);
 const put=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};put("incomePaid",money(paid));put("incomeUnpaid",money(unpaid));put("incomeCount",currentAdminOrders.length);applyOrderFilters();
}
function applyOrderFilters(){
 const q=(document.getElementById("orderSearch")?.value||"").toLowerCase(),period=document.getElementById("orderDateFilter")?.value||"all",status=document.getElementById("orderStatusFilter")?.value||"all";
 const start=new Date();start.setHours(0,0,0,0);if(period==="week")start.setDate(start.getDate()-((start.getDay()+6)%7));if(period==="month")start.setDate(1);
 const exactDate=document.getElementById("orderSpecificDate")?.value||"";
 const rows=currentAdminOrders.filter(o=>{const d=new Date(o.createdAt||o.created_at);const exactMatch=!exactDate||d.toISOString().slice(0,10)===exactDate;return(!q||[o.id,o.customer,o.email].join(" ").toLowerCase().includes(q))&&exactMatch&&(period==="all"||d>=start)&&(status==="all"||orderGroupStatus(o)===status);});
 const tbody=document.getElementById("orderRecords");if(tbody)tbody.innerHTML=rows.map(o=>`<tr><td>${safe(o.id)}<small>${new Date(o.createdAt||o.created_at).toLocaleString()}</small></td><td>${safe(o.customer)}<small>${safe(o.email)}</small></td><td>${(o.items||[]).map(i=>`${safe(i.name)} × ${i.qty}${i.variation?` (${safe(i.variation)})`:""}`).join("<br>")}<small>${safe([o.address,o.city,o.state,o.phone].filter(Boolean).join(", "))}</small></td><td>${money(o.total)}</td><td><strong>${orderGroupStatus(o)}</strong><select onchange="changeOrderStatus('${safe(o.id)}',this.value)"><option value="Unpaid order" ${orderGroupStatus(o)==="Unpaid order"?"selected":""}>Unpaid order</option><option value="Paid" ${orderGroupStatus(o)==="Paid"?"selected":""}>Paid</option><option value="Processing" ${orderGroupStatus(o)==="Processing"?"selected":""}>Processing</option><option value="Completed" ${orderGroupStatus(o)==="Completed"?"selected":""}>Completed</option></select></td><td><button class="btn-danger order-delete" onclick="deleteOrder('${safe(o.id)}')">Delete</button></td></tr>`).join("")||'<tr><td colspan="6">No matching orders.</td></tr>';
 const groups=document.getElementById("orderGroups");if(groups)groups.innerHTML=["Unpaid order","Paid","Processing","Completed"].map(label=>{const list=rows.filter(o=>orderGroupStatus(o)===label);return `<details class="order-group"><summary>${label} (${list.length}) · ${money(list.reduce((s,o)=>s+Number(o.total||0),0))}</summary><div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Date</th></tr></thead><tbody>${list.map(o=>`<tr><td>${safe(o.id)}</td><td>${safe(o.customer)}<small>${safe(o.email)}</small></td><td>${(o.items||[]).map(i=>`${safe(i.name)} × ${i.qty}`).join("<br>")}</td><td>${money(o.total)}</td><td>${new Date(o.createdAt||o.created_at).toLocaleDateString()}</td></tr>`).join("")||'<tr><td colspan="5">No orders in this group.</td></tr>'}</tbody></table></div></details>`;}).join("");
}
async function changeOrderStatus(id,value){
 const o=currentAdminOrders.find(x=>String(x.id)===String(id));if(!o)return;let u={};
 if(value==="Unpaid order")u={payment_status:"Unpaid",order_status:"Pending"};if(value==="Paid")u={payment_status:"Paid",order_status:"Pending"};if(value==="Processing")u={payment_status:"Paid",order_status:"Processing"};if(value==="Completed")u={payment_status:"Paid",order_status:"Completed"};
 if(o.cloud){const {error}=await db.from("orders").update(u).eq("id",id);if(error)return alert(error.message);await renderCloudAdminRecords();}
 else{const all=read(STORE.orders),x=all.find(x=>String(x.id)===String(id));if(x){x.paid=u.payment_status;x.status=u.order_status;write(STORE.orders,all);}renderAdminRecords();}
}
async function deleteOrder(id){
 if(!confirm("Permanently delete this order?"))return;const o=currentAdminOrders.find(x=>String(x.id)===String(id));
 if(o?.cloud){const {error}=await db.from("orders").delete().eq("id",id);if(error)return alert(error.message);await renderCloudAdminRecords();}
 else{write(STORE.orders,read(STORE.orders).filter(x=>String(x.id)!==String(id)));renderAdminRecords();}
}
async function fetchAllLoginHistory() {
    const pageSize = 1000;
    const allRows = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await db.from("login_history")
            .select("*")
            .order("created_at", { ascending: false })
            .range(from, from + pageSize - 1);
        if (error) return { data: null, error };
        allRows.push(...(data || []));
        if (!data || data.length < pageSize) break;
    }
    return { data: allRows, error: null };
}

async function renderCloudAdminRecords() {
    if (!SUPABASE_READY) return;

    try {
        const [
            logsResult,
            profilesResult,
            ordersResult,
            applicationsResult,
            appointmentsResult
        ] = await Promise.all([
            fetchAllLoginHistory(),

            db.from("profiles").select("*")
                .order("created_at", { ascending: false }),

            db.from("orders").select("*")
                .order("created_at", { ascending: false }),

            db.from("hairstylist_applications").select("*")
                .order("created_at", { ascending: false }),

            db.from("appointments").select("*")
                .order("created_at", { ascending: false })
        ]);

        const put = (id, html) => {
            const element = document.getElementById(id);
            if (element) element.innerHTML = html;
        };

        if (logsResult.error) {
            cloudLoginHistoryLoaded = true;
            cloudLoginHistory = [];
            console.error("Could not retrieve login history:", logsResult.error);
            put("loginRecords", '<tr><td colspan="4">Could not load login history. Check the login_history table permissions.</td></tr>');
        } else {
            cloudLoginHistory = logsResult.data || [];
            cloudLoginHistoryLoaded = true;
            paintLoginHistory(cloudLoginHistory);
        }

        if (profilesResult.data) {
            put(
                "customerRecords",
                profilesResult.data.map(item => `
                    <tr>
                        <td>${safe(item.full_name || "—")}</td>
                        <td>${safe(item.email || "—")}</td>
                        <td>${safe(item.phone || "—")}</td>
                        <td>${safe(
                            [item.address, item.city, item.state]
                                .filter(Boolean)
                                .join(", ") || "Not supplied"
                        )}</td>
                    </tr>
                `).join("") || '<tr><td colspan="4">No customers yet.</td></tr>'
            );
        }

        if (ordersResult.data) renderOrderDashboard(ordersResult.data.map(o=>({id:String(o.id),customer:o.customer_name,email:o.email,phone:o.phone,address:o.address,city:o.city,state:o.state,items:o.items||[],total:Number(o.total),paid:o.payment_status||"Unpaid",status:o.order_status||"Pending",createdAt:o.created_at,cloud:true})));

        if (appointmentsResult.error) {
    console.error(
        "KÉMOLUX appointment retrieval failed:",
        appointmentsResult.error
    );
} else {
    console.log(
        "Appointments retrieved from Supabase:",
        appointmentsResult.data
    );

    put(
        "appointmentRecords",
        appointmentsResult.data.length
            ? appointmentsResult.data.map(item => `
                <tr>
                    <td>
                        ${new Date(item.created_at).toLocaleString()}
                    </td>
                    <td>
                        ${safe(item.name)}
                        <small>
                            ${safe(item.email)} · ${safe(item.phone)}
                        </small>
                    </td>
                    <td>
                        ${safe(item.service)}
                        · ${safe(item.service_type || "")}
                    </td>
                    <td>
                        ${safe(item.date || "—")}
                        <small>${safe(item.address || "")}</small>
                    </td>
                    <td>${safe(item.status || "New")}</td>
                </tr>
            `).join("")
            : '<tr><td colspan="5">No appointments yet.</td></tr>'
    );
}


        if (applicationsResult.data) {
            put(
                "applicationRecords",
                applicationsResult.data.map(item => `
                    <tr>
                        <td>${new Date(item.created_at).toLocaleString()}</td>
                        <td>${safe(item.name)}</td>
                        <td>${safe(item.email)} · ${safe(item.phone)}</td>
                        <td>${safe(item.experience)}</td>
                        <td>${safe(item.status || "New")}</td>
                    </tr>
                `).join("") || '<tr><td colspan="5">No applications yet.</td></tr>'
            );
        }

    } catch (error) {
        console.warn("Admin cloud records unavailable", error);
    }
}

async function updateCloudOrder(id, key, value) {
    if (!SUPABASE_READY) return;

    const { error } = await db
        .from("orders")
        .update({ [key]: value })
        .eq("id", id);

    if (error) alert(error.message);
}

function updateOrder(id, key, value) {
    const orders = read(STORE.orders);

    const order = orders.find(
        item => String(item.id) === String(id)
    );

    if (order) {
        order[key] = value;
        write(STORE.orders, orders);
    }
}

function showAdminTab(id, button) {
    document.querySelectorAll(".admin-panel").forEach(panel => {
        panel.hidden = panel.id !== id;
    });

    document.querySelectorAll(".admin-tab").forEach(tab => {
        tab.classList.toggle("active", tab === button);
    });
}

/* =========================================================
   12. APPOINTMENT AND APPLICATION FORMS
========================================================= */


function initForms() {
    const bookingForm = document.getElementById("booking-form");

    if (bookingForm && !bookingForm.dataset.initialized) {
        bookingForm.dataset.initialized = "true";

        bookingForm.addEventListener("submit", async event => {
            event.preventDefault();

            const button = bookingForm.querySelector('[type="submit"]');
            const originalText = button?.textContent;

            if (button) {
                button.disabled = true;
                button.textContent = "SUBMITTING...";
            }

            try {
                const data = Object.fromEntries(
                    new FormData(bookingForm)
                );

                const user = activeUser();

                const appointment = {
                    name: data.name.trim(),
                    email: data.email.trim().toLowerCase(),
                    phone: data.phone.trim(),
                    location: data.location.trim(),
                    address: data.address.trim(),
                    date: data.date,
                    budget: Number(data.budget),
                    service_type: data.service_type,
                    service: data.service
                };

                if (SUPABASE_READY) {
                    const payload = {
                        ...appointment,
                        user_id: user?.id || null
                    };

                    const { error } = await db
                        .from("appointments")
                        .insert(payload);

                    if (error) {
                        console.error(
                            "KÉMOLUX appointment submission failed:",
                            error
                        );

                        throw error;
                    }

                    console.log(
                        "KÉMOLUX appointment successfully saved."
                    );

                } else {
                    const appointments = read(STORE.appointments);

                    appointments.push({
                        ...appointment,
                        id: Date.now(),
                        createdAt: new Date().toISOString(),
                        status: "New"
                    });

                    write(STORE.appointments, appointments);
                }

                const formContainer =
                    document.getElementById("form-container");

                const successMessage =
                    document.getElementById("success-message");

                if (formContainer) {
                    formContainer.style.display = "none";
                }

                if (successMessage) {
                    successMessage.style.display = "block";
                }

            } catch (error) {
                console.error("Appointment error:", error);

                alert(
                    "Your appointment could not be submitted. " +
                    (error.message || "Please try again.")
                );

                if (button) {
                    button.disabled = false;
                    button.textContent = originalText;
                }
            }
        });
    }

    const applicationForm =
        document.getElementById("application-form");

    if (applicationForm && !applicationForm.dataset.initialized) {
        applicationForm.dataset.initialized = "true";

        applicationForm.addEventListener("submit", async event => {
            event.preventDefault();

            const button =
                applicationForm.querySelector('[type="submit"]');

            if (button) {
                button.disabled = true;
                button.textContent = "SUBMITTING...";
            }

            try {
                const data = Object.fromEntries(
                    new FormData(applicationForm)
                );

                const user = activeUser();

                if (SUPABASE_READY) {
                    const { error } = await db
                        .from("hairstylist_applications")
                        .insert({
                            ...data,
                            user_id: user?.id || null
                        });

                    if (error) throw error;

                } else {
                    const applications = read(STORE.applications);

                    applications.push({
                        ...data,
                        id: Date.now(),
                        createdAt: new Date().toISOString(),
                        status: "New"
                    });

                    write(STORE.applications, applications);
                }

                applicationForm.innerHTML = `
                    <h2>Application received</h2>
                    <p>Thank you for your interest in joining KÉMOLUX.</p>
                `;

            } catch (error) {
                console.error("Application submission failed:", error);

                alert(error.message || "Could not submit application.");

                if (button) {
                    button.disabled = false;
                    button.textContent = "Submit application";
                }
            }
        });
    }
}


/* =========================================================
   13. ADMIN LOGIN AND PAGE INITIALISATION
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    const adminLoginForm = document.getElementById("admin-login-form");

    if (adminLoginForm) {
        adminLoginForm.addEventListener("submit", async event => {
            event.preventDefault();

            if (!SUPABASE_READY) {
                document.getElementById("admin-login-message").textContent =
                    "Supabase is not configured yet. Add your project URL and anon key to supabase-config.js.";

                return;
            }

            const email = document.getElementById("admin-email").value.trim();
            const password = document.getElementById("admin-password").value;

            const { data, error } = await db.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                document.getElementById("admin-login-message").textContent =
                    error.message;

                return;
            }

            const {
                data: adminAccount,
                error: adminAccountError
            } = await db
                .from("admin_accounts")
                .select("user_id")
                .eq("user_id", data.user.id)
                .eq("is_active", true)
                .maybeSingle();

            if (adminAccountError || !adminAccount) {
                await db.auth.signOut();

                document.getElementById("admin-login-message").textContent =
                    "This account is not authorised for admin access.";

                return;
            }

            await db.from("login_history").insert({
                user_id: data.user.id,
                email,
                activity: "Admin login"
            });

            location.href = "admin.html";
        });
    }

    if (document.getElementById("popupAd")) {
        setTimeout(() => {
            const popup = document.getElementById("popupAd");

            if (
                popup &&
                !sessionStorage.getItem("kemoluxPopupClosed")
            ) {
                popup.style.display = "flex";
            }
        }, 8000);
    }

    const closeAssistant = document.getElementById("close-assistant");

    if (closeAssistant) {
        closeAssistant.onclick = () => {
            const assistant = document.getElementById("movable-assistant");

            if (assistant) {
                assistant.style.display = "none";
            }
        };
    }

    updateCounts();
    ensureCheckoutAccess();

    initAdmin();
    initCollection();
    initCart();
    initWishlist();
    if(document.getElementById("shipping-form")){
      (async()=>{try{const {data:{user}}=await db.auth.getUser();if(!user)return;
        const {data:profile}=await db.from("profiles").select("phone,address,city,state").eq("id",user.id).maybeSingle();
        if(profile)["phone","address","city","state"].forEach(k=>{const el=document.querySelector(`[name="${k}"]`);if(el&&profile[k])el.value=profile[k];});
      }catch(e){console.warn("Saved shipping details unavailable.",e);}})();
    }
    initForms();


    const shippingForm = document.getElementById("shipping-form");

    if (shippingForm) {
        shippingForm.addEventListener("submit", submitShipping);
    }

    const animatedText = document.getElementById("animated-text");

    if (animatedText && !animatedText.dataset.done) {
        animatedText.dataset.done = "1";
        animatedText.textContent =
            "Hi there! I am Kemm, your shopping assistant. Reach out if you need anything.";
    }
});

/* =========================================================
   14. SUPABASE PRODUCT DIAGNOSTICS
========================================================= */

(async function diagnoseProducts() {
    console.log("Supabase configured:", SUPABASE_READY);
    console.log("Supabase URL:", window.KEMOLUX_SUPABASE_URL);

    if (!db) {
        console.error("Supabase client was not created.");
        return;
    }

    const { data, error } = await db
        .from("products")
        .select("id, name, category, active")
        .eq("active", true);

    console.log("Product query error:", error);
    console.log("Products returned:", data);
})();

/* =========================================================
   15. EXPOSE FUNCTIONS USED BY HTML BUTTONS
========================================================= */

Object.assign(window, {
    closePopup,
    goToService,
    toggleMode,
    handleAuth,
    forgotPassword,
    logout,

    initAdmin,
    addVariationOption,
    addVariationGroup,
    renderAdminProducts,
    editProduct,
    closeProductEditModal,
    renderProductEditPreview,
    deleteProduct,
    applyOrderFilters,
    changeOrderStatus,
    deleteOrder,
    filterProducts,

    initCollection,
    productCard,
    renderProducts,
    openModal,
    selectedVariations,
    updateModalPrice,
    closeModal,

    addToCart,
    addToCartFromModal,
    toggleWish,

    initCart,
    renderCart,
    changeQty,
    removeCart,

    initWishlist,
    renderWishlist,

    submitShipping,
    renderAdminRecords,
    renderCloudAdminRecords,
    updateCloudOrder,
    updateOrder,
    showAdminTab,
    initForms,
    updateCounts
});