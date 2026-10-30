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

            const { data: state } = await db
                .from("customer_state")
                .select("*")
                .eq("user_id", user.id)
                .maybeSingle();

            if (state) {
                write(`kemolux_cart_${email}`, state.cart || []);
                write(`kemolux_wishlist_${email}`, state.wishlist || []);
            }

            alert(
                window.isLoginMode
                    ? "Welcome back!"
                    : "Your account is ready."
            );

            location.href = "home.html";
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

    location.href = "home.html";
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

function logout() {
    localStorage.removeItem(STORE.active);
    location.href = "index.html";
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
    const form = document.getElementById("productForm");

    if (!form) return;

    if (SUPABASE_READY) {
        const {
            data: { session }
        } = await db.auth.getSession();

        if (!session) {
            location.href = "login.html";
            return;
        }

        const { data: profile } = await db
            .from("profiles")
            .select("role")
            .eq("id", session.user.id)
            .maybeSingle();

        if (profile?.role !== "admin") {
            const shell = document.querySelector(".admin-shell");

            if (shell) {
                shell.innerHTML = `
                    <section class="admin-panel">
                        <h1>Admin access required</h1>
                        <p>This account is not authorised to manage KÉMOLUX.</p>
                        <button class="btn" onclick="logout()">Sign out</button>
                    </section>
                `;
            }

            return;
        }
    } else {
        location.href = "login.html";
        return;
    }

    const {
        data: cloudProducts,
        error: cloudProductsError
    } = await db
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });

    console.log("Admin products returned:", cloudProducts);
    console.log("Admin product query error:", cloudProductsError);
    console.log("Local products:", products);

    if (cloudProductsError) {
        console.error("Admin product load failed:", cloudProductsError);

        alert(
            "Could not load saved products: " +
            cloudProductsError.message
        );
    }

    if (cloudProducts && cloudProducts.length) {
        const cloud = cloudProducts.map(product => ({
            id: String(product.id),
            name: product.name,
            category: product.category,
            image: product.image_url || "images/logo.jpeg",
            desc: product.description,
            qty: product.stock,
            price: Number(product.price),
            variations: product.variations || []
        }));

        products = [
            ...cloud,
            ...products.filter(localProduct =>
                !cloud.some(cloudProduct =>
                    cloudProduct.name.toLowerCase() ===
                    String(localProduct.name).toLowerCase()
                )
            )
        ];
    }

    renderAdminProducts();
    renderCloudAdminRecords();

    form.addEventListener("submit", event => {
        event.preventDefault();

        const file = document.getElementById("pImage").files[0];

        if (!file) {
            return alert("Choose a product image.");
        }

        const reader = new FileReader();

        reader.onload = () => {
            const variations = [
                ...document.querySelectorAll(".variation-group")
            ].flatMap(group => {
                const type =
                    group.querySelector(".vType")?.value || "Variation";

                return [
                    ...group.querySelectorAll(".variation-row")
                ]
                    .map(row => ({
                        type,
                        option: row.querySelector(".vOption")?.value.trim(),
                        price: Number(
                            row.querySelector(".vPrice")?.value || 0
                        )
                    }))
                    .filter(variation => variation.option);
            });

            const newProduct = {
                id: crypto.randomUUID
                    ? crypto.randomUUID()
                    : Date.now(),

                name: document.getElementById("pName").value.trim(),
                category: document.getElementById("pCategory").value,
                image: reader.result,
                desc: document.getElementById("pDesc").value.trim(),
                qty: Number(document.getElementById("pQty").value || 0),
                variations,
                price: Number(document.getElementById("pPrice").value || 0)
            };

            if (SUPABASE_READY) {
                (async () => {
                    try {
                        const extension = (
                            file.name.split(".").pop() || "jpg"
                        ).replace(/[^a-z0-9]/gi, "");

                        const path =
                            `${Date.now()}-` +
                            `${Math.random().toString(36).slice(2)}.` +
                            extension;

                        const {
                            data: uploaded,
                            error: uploadError
                        } = await db.storage
                            .from("product-images")
                            .upload(path, file, {
                                upsert: true,
                                contentType: file.type
                            });

                        if (uploadError) throw uploadError;

                        const { data: publicData } = db.storage
                            .from("product-images")
                            .getPublicUrl(uploaded.path);

                        const {
                            data: row,
                            error
                        } = await db
                            .from("products")
                            .insert({
                                name: newProduct.name,
                                category: newProduct.category,
                                image_url: publicData.publicUrl,
                                description: newProduct.desc,
                                stock: newProduct.qty,
                                variations: newProduct.variations,
                                price: newProduct.price,
                                active: true
                            })
                            .select()
                            .single();

                        if (error) throw error;

                        newProduct.id = String(row.id);
                        newProduct.image = row.image_url;

                        products.unshift(newProduct);
                        saveProducts();

                        renderAdminProducts();
                        renderProducts();

                        alert(
                            "Product published. Open collection.html and refresh to verify it appears."
                        );

                    } catch (error) {
                        alert(
                            "Could not publish product to Supabase: " +
                            error.message
                        );
                    }
                })();

            } else {
                products.push(newProduct);
                saveProducts();
            }

            form.reset();

            const variationsContainer = document.getElementById("variations");

            if (variationsContainer) {
                variationsContainer.innerHTML = `
                    <div class="variation-group">
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
                            <input type="text" placeholder="Option e.g. Black" class="vOption">
                            <input type="number" placeholder="Extra price (₦)" class="vPrice" min="0" value="0">

                            <button type="button" class="btn-ghost" onclick="addVariationOption(this)">
                                + Option
                            </button>
                        </div>

                        <button type="button" class="btn-ghost" onclick="addVariationGroup()">
                            + Variation type
                        </button>
                    </div>
                `;
            }

            renderAdminProducts();
            renderProducts();

            if (!SUPABASE_READY) {
                alert("Product added to the collection.");
            }
        };

        reader.readAsDataURL(file);
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

function renderAdminProducts() {
    const wrapper = document.getElementById("adminProducts");

    if (!wrapper) return;

    wrapper.innerHTML = products.length
        ? products.map(product => `
            <article class="admin-product">
                <img src="${safe(product.image)}" alt="${safe(product.name)}">

                <div>
                    <b>${safe(product.name)}</b>
                    <p>${safe(product.category)} · ${money(product.price)}</p>

                    <small>
                        Variations: ${safe(
                            (product.variations || [])
                                .map(variation =>
                                    (variation.type || product.vType || "Variation") +
                                    ": " + variation.option
                                )
                                .join(", ") || "None"
                        )}
                        <br>Stock: ${Number(product.qty || 0)}
                    </small>
                </div>

                <button class="btn-danger" onclick="deleteProduct('${safe(String(product.id))}')">
                    Delete
                </button>
            </article>
        `).join("")
        : "<p>No products published yet.</p>";
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
        item.classList.toggle("active", item === button);
    });

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
            image: product.image_url || "images/logo.jpeg",
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
            >

            <div class="card-body">
                <h3>${safe(product.name)}</h3>
                <p class="category-label">${safe(product.category)}</p>
                <p class="price">${money(product.price)}</p>
                <p>${safe((product.desc || "").slice(0, 110))}</p>

                <div class="flex">
                    <button class="btn" onclick="addToCart('${id}')">
                        Add to Cart
                    </button>

                    <button class="btn-ghost" onclick="toggleWish('${id}')">
                        ♡ Wishlist
                    </button>
                </div>
            </div>
        </article>
    `;
}

function renderProducts() {
    const wrapper = document.getElementById("productGrid");

    if (!wrapper) return;

    const filteredProducts = products.filter(product =>
        currentFilter === "all" || product.category === currentFilter
    );

    wrapper.innerHTML = filteredProducts.length
        ? filteredProducts.map(productCard).join("")
        : `
            <div class="empty-state">
                <h3>Our collection is being prepared</h3>
                <p>New KÉMOLUX pieces will appear here soon.</p>
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

    body.innerHTML = `
        <button
            class="modal-close"
            onclick="document.getElementById('productModal').classList.remove('active')"
        >
            ×
        </button>

        <img src="${safe(product.image)}" alt="${safe(product.name)}">

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

    modal.classList.add("active");
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
        ? cart.map((item, index) => {
            const quantity = Number(item.qty || 1);
            const price = Number(item.price || 0);
            const subtotal = price * quantity;

            total += subtotal;

            return `
                <article class="cart-item">
                    <img src="${safe(item.image)}" alt="${safe(item.name)}">

                    <div class="cart-item-info">
                        <h3>${safe(item.name)}</h3>
                        <p>${safe(item.variation || "Standard")}</p>
                        <p class="price">${money(price)} each</p>

                        <div class="qty-control">
                            <button onclick="changeQty(${index}, -1)">−</button>

                            <span>${quantity}</span>

                            <button onclick="changeQty(${index}, 1)">+</button>

                            <button class="btn-danger" onclick="removeCart(${index})">
                                Remove
                            </button>
                        </div>
                    </div>

                    <strong>${money(subtotal)}</strong>
                </article>
            `;
        }).join("")
        : `
            <div class="empty-state">
                <h3>Your cart is waiting</h3>
                <p>Add something lovely from the collection.</p>
                <a class="btn" href="collection.html">Explore collection</a>
            </div>
        `;

    const totalElement = document.getElementById("cartTotal");

    if (totalElement) {
        totalElement.textContent = `Total: ${money(total)}`;
    }

    const checkoutLink = document.getElementById("checkoutLink");

    if (checkoutLink) {
        checkoutLink.href = cart.length
            ? "shipping.html"
            : "collection.html";
    }
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
            <div class="grid">
                ${wishlist.map(product => {
                    const id = safe(String(product.id));

                    return `
                        <article class="card">
                            <img
                                class="product-image"
                                src="${safe(product.image)}"
                                alt="${safe(product.name)}"
                            >

                            <div class="card-body">
                                <h3>${safe(product.name)}</h3>

                                <p class="price">${money(product.price)}</p>

                                <button class="btn" onclick="addToCart('${id}')">
                                    Add to Cart
                                </button>

                                <button class="btn-danger" onclick="toggleWish('${id}')">
                                    Remove
                                </button>
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

function renderAdminRecords() {
    const orders = read(STORE.orders);
    const customers = read(STORE.customers);
    const logs = read(STORE.logins);
    const applications = read(STORE.applications);
    const appointments = read(STORE.appointments);

    const byId = id => document.getElementById(id);

    if (byId("loginRecords")) {
        byId("loginRecords").innerHTML = logs.length
            ? logs.slice().reverse().map(item => `
                <tr>
                    <td>${new Date(item.at).toLocaleString()}</td>
                    <td>${safe(item.name)}</td>
                    <td>${safe(item.email)}</td>
                    <td>${safe(item.action)}</td>
                </tr>
            `).join("")
            : '<tr><td colspan="4">No login activity yet.</td></tr>';
    }

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

    if (byId("orderRecords")) {
        byId("orderRecords").innerHTML = orders.length
            ? orders.slice().reverse().map(order => `
                <tr>
                    <td>
                        ${safe(order.id)}
                        <small>${new Date(order.createdAt).toLocaleString()}</small>
                    </td>

                    <td>
                        ${safe(order.customer)}
                        <small>${safe(order.email)}</small>
                    </td>

                    <td>
                        ${order.items.map(item =>
                            `${safe(item.name)} × ${item.qty}` +
                            (item.variation ? ` (${safe(item.variation)})` : "")
                        ).join("<br>")}

                        <small>
                            ${safe(order.address)}, ${safe(order.city)},
                            ${safe(order.state)} · ${safe(order.phone)}
                        </small>
                    </td>

                    <td>${money(order.total)}</td>

                    <td>
                        <select onchange="updateOrder('${safe(String(order.id))}', 'status', this.value)">
                            ${["Pending", "Processing", "Shipped", "Completed", "Cancelled"]
                                .map(status => `
                                    <option ${order.status === status ? "selected" : ""}>
                                        ${status}
                                    </option>
                                `).join("")}
                        </select>

                        <select onchange="updateOrder('${safe(String(order.id))}', 'paid', this.value)">
                            ${["Unpaid", "Paid"].map(status => `
                                <option ${order.paid === status ? "selected" : ""}>
                                    ${status}
                                </option>
                            `).join("")}
                        </select>
                    </td>
                </tr>
            `).join("")
            : '<tr><td colspan="5">No orders yet.</td></tr>';
    }

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

    const period = document.getElementById("recordPeriod")?.value || "all";
    const start = new Date();

    if (period === "month") start.setDate(1);
    if (period === "day") start.setHours(0, 0, 0, 0);

    const filteredLogs = logs.filter(item =>
        period === "all" || new Date(item.at) >= start
    );

    const summary = byId("recordSummary");

    if (summary) {
        summary.textContent =
            `${filteredLogs.length} login/sign-up records · ` +
            `${orders.length} orders · ` +
            `${customers.length} customers · ` +
            `${appointments.length} appointments · ` +
            `${applications.length} applications`;
    }
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
            db.from("login_history")
    .select("*")
    .order("created_at", { ascending: false })
    .range(0, 999),

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

        if (logsResult.data) {
            put(
                "loginRecords",
                logsResult.data.length
                    ? logsResult.data.map(item => `
                        <tr>
                            <td>${new Date(item.created_at).toLocaleString()}</td>
                            <td>${safe(item.email)}</td>
                            <td>${safe(item.email)}</td>
                            <td>${safe(item.activity)}</td>
                        </tr>
                    `).join("")
                    : '<tr><td colspan="4">No login activity yet.</td></tr>'
            );
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

        if (ordersResult.data) {
            put(
                "orderRecords",
                ordersResult.data.map(order => `
                    <tr>
                        <td>
                            ${safe(order.id)}
                            <small>${new Date(order.created_at).toLocaleString()}</small>
                        </td>

                        <td>
                            ${safe(order.customer_name)}
                            <small>${safe(order.email)}</small>
                        </td>

                        <td>
                            ${(order.items || []).map(item =>
                                `${safe(item.name)} × ${item.qty}` +
                                (item.variation ? ` (${safe(item.variation)})` : "")
                            ).join("<br>")}

                            <small>
                                ${safe([
                                    order.address,
                                    order.city,
                                    order.state,
                                    order.phone
                                ].filter(Boolean).join(", "))}
                            </small>
                        </td>

                        <td>${money(order.total)}</td>

                        <td>
                            <select onchange="updateCloudOrder('${safe(String(order.id))}', 'order_status', this.value)">
                                ${["Pending", "Processing", "Shipped", "Completed", "Cancelled"]
                                    .map(status => `
                                        <option ${order.order_status === status ? "selected" : ""}>
                                            ${status}
                                        </option>
                                    `).join("")}
                            </select>

                            <select onchange="updateCloudOrder('${safe(String(order.id))}', 'payment_status', this.value)">
                                ${["Unpaid", "Paid"].map(status => `
                                    <option ${order.payment_status === status ? "selected" : ""}>
                                        ${status}
                                    </option>
                                `).join("")}
                            </select>
                        </td>
                    </tr>
                `).join("") || '<tr><td colspan="5">No orders yet.</td></tr>'
            );
        }

        
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
                data: profile,
                error: profileError
            } = await db
                .from("profiles")
                .select("role")
                .eq("id", data.user.id)
                .maybeSingle();

            if (profileError || profile?.role !== "admin") {
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

    initAdmin();
    initCollection();
    initCart();
    initWishlist();
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
    deleteProduct,
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