import { db, schema } from "./index";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding database...");

  const [existingOrg] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, "demo"))
    .limit(1);

  if (existingOrg) {
    console.log("ℹ️ Seed ya fue ejecutado anteriormente (slug: demo).");
    console.log("   No se realizaron cambios para evitar duplicados.");
    process.exit(0);
  }

  // 1. Create organization
  const [org] = await db
    .insert(schema.organizations)
    .values({
      name: "Restaurante Demo",
      slug: "demo",
      plan: "pro",
      settings: { theme: "default" },
    })
    .returning();

  console.log(`✅ Organization: ${org.name} (${org.id})`);

  // 2. Create branch
  const [branch] = await db
    .insert(schema.branches)
    .values({
      organization_id: org.id,
      name: "Sede Principal",
      slug: "principal",
      address: "Av. Javier Prado 1234, San Isidro, Lima",
      phone: "+51 1 234 5678",
      timezone: "America/Lima",
      currency: "PEN",
      tax_rate: 1800, // 18% IGV
      settings: {},
    })
    .returning();

  console.log(`✅ Branch: ${branch.name} (${branch.id})`);

  // 3. Create admin user
  const passwordHash = await hash("admin12345");

  const [admin] = await db
    .insert(schema.users)
    .values({
      organization_id: org.id,
      email: "admin@restai.pe",
      password_hash: passwordHash,
      name: "Admin Demo",
      role: "org_admin",
    })
    .returning();

  // Link admin to branch
  await db.insert(schema.userBranches).values({
    user_id: admin.id,
    branch_id: branch.id,
  });

  console.log(`✅ Admin: ${admin.email} (password: admin12345)`);

  // 4. Create staff users
  const staffData = [
    { email: "gerente@restai.pe", name: "Maria Garcia", role: "branch_manager" as const, password: "gerente123" },
    { email: "cajero@restai.pe", name: "Carlos Lopez", role: "cashier" as const, password: "cajero1234" },
    { email: "mesero@restai.pe", name: "Juan Perez", role: "waiter" as const, password: "mesero1234" },
    { email: "cocina@restai.pe", name: "Rosa Martinez", role: "kitchen" as const, password: "cocina1234" },
  ];

  for (const s of staffData) {
    const ph = await hash(s.password);
    const [user] = await db
      .insert(schema.users)
      .values({
        organization_id: org.id,
        email: s.email,
        password_hash: ph,
        name: s.name,
        role: s.role,
      })
      .returning();

    await db.insert(schema.userBranches).values({
      user_id: user.id,
      branch_id: branch.id,
    });

    console.log(`✅ Staff: ${s.email} (${s.role}, password: ${s.password})`);
  }

  // 5. Create menu categories
  const categories = [
    { name: "Entradas", description: "Para compartir", sort_order: 1 },
    { name: "Platos de Fondo", description: "Nuestras especialidades", sort_order: 2 },
    { name: "Ceviches", description: "Frescos del día", sort_order: 3 },
    { name: "Bebidas", description: "Refrescantes", sort_order: 4 },
    { name: "Postres", description: "Para endulzar", sort_order: 5 },
  ];

  const createdCategories = [];
  for (const cat of categories) {
    const [c] = await db
      .insert(schema.menuCategories)
      .values({
        branch_id: branch.id,
        organization_id: org.id,
        ...cat,
      })
      .returning();
    createdCategories.push(c);
  }

  console.log(`✅ ${createdCategories.length} categorías creadas`);

  // 6. Create menu items (prices in cents - Soles)
  const menuItems = [
    // Entradas
    { categoryIdx: 0, name: "Tequeños de Lomo Saltado", price: 2500, prep: 10, desc: "6 unidades con salsa criolla" },
    { categoryIdx: 0, name: "Papa a la Huancaína", price: 1800, prep: 8, desc: "Clásica receta peruana" },
    { categoryIdx: 0, name: "Causa Limeña", price: 2200, prep: 10, desc: "Rellena de pollo" },
    // Platos de Fondo
    { categoryIdx: 1, name: "Lomo Saltado", price: 3800, prep: 20, desc: "Con papas fritas y arroz" },
    { categoryIdx: 1, name: "Ají de Gallina", price: 3200, prep: 18, desc: "Cremoso y tradicional" },
    { categoryIdx: 1, name: "Arroz con Mariscos", price: 4200, prep: 25, desc: "Mixto de mariscos" },
    { categoryIdx: 1, name: "Seco de Res", price: 3500, prep: 20, desc: "Con frejoles y arroz" },
    // Ceviches
    { categoryIdx: 2, name: "Ceviche Clásico", price: 3500, prep: 12, desc: "Pescado fresco del día" },
    { categoryIdx: 2, name: "Ceviche Mixto", price: 4500, prep: 15, desc: "Pescado, pulpo, camarón y calamar" },
    { categoryIdx: 2, name: "Tiradito Nikkei", price: 3800, prep: 10, desc: "En salsa de maracuyá" },
    // Bebidas
    { categoryIdx: 3, name: "Chicha Morada", price: 800, prep: 2, desc: "Vaso grande" },
    { categoryIdx: 3, name: "Inca Kola 500ml", price: 600, prep: 1, desc: "" },
    { categoryIdx: 3, name: "Limonada Frozen", price: 1200, prep: 5, desc: "Con hierbabuena" },
    { categoryIdx: 3, name: "Pisco Sour", price: 2500, prep: 5, desc: "Clásico peruano" },
    // Postres
    { categoryIdx: 4, name: "Suspiro a la Limeña", price: 1500, prep: 5, desc: "Dulce tradición" },
    { categoryIdx: 4, name: "Picarones", price: 1800, prep: 10, desc: "Con miel de chancaca" },
    { categoryIdx: 4, name: "Tres Leches", price: 1600, prep: 5, desc: "Suave y esponjoso" },
  ];

  for (const item of menuItems) {
    await db.insert(schema.menuItems).values({
      category_id: createdCategories[item.categoryIdx].id,
      branch_id: branch.id,
      organization_id: org.id,
      name: item.name,
      description: item.desc || null,
      price: item.price,
      preparation_time_min: item.prep,
    });
  }

  console.log(`✅ ${menuItems.length} items de menú creados`);

  // 6b. Create modifier groups and modifiers
  const modGroups = [
    {
      name: "Punto de coccion",
      min_selections: 1,
      max_selections: 1,
      is_required: true,
      modifiers: [
        { name: "Termino medio", price: 0 },
        { name: "Tres cuartos", price: 0 },
        { name: "Bien cocido", price: 0 },
      ],
      // Link to: Lomo Saltado, Seco de Res
      linkToItems: ["Lomo Saltado", "Seco de Res"],
    },
    {
      name: "Proteina adicional",
      min_selections: 0,
      max_selections: 2,
      is_required: false,
      modifiers: [
        { name: "Pollo extra", price: 500 },
        { name: "Carne extra", price: 800 },
        { name: "Camaron extra", price: 1200 },
      ],
      linkToItems: ["Arroz con Mariscos", "Ceviche Mixto", "Lomo Saltado"],
    },
    {
      name: "Tamano de bebida",
      min_selections: 1,
      max_selections: 1,
      is_required: true,
      modifiers: [
        { name: "Regular", price: 0 },
        { name: "Grande", price: 400 },
      ],
      linkToItems: ["Chicha Morada", "Limonada Frozen"],
    },
    {
      name: "Extras",
      min_selections: 0,
      max_selections: 3,
      is_required: false,
      modifiers: [
        { name: "Arroz extra", price: 300 },
        { name: "Papas extra", price: 400 },
        { name: "Salsa criolla", price: 200 },
        { name: "Aji extra", price: 100 },
      ],
      linkToItems: ["Lomo Saltado", "Aji de Gallina", "Seco de Res", "Arroz con Mariscos"],
    },
    {
      name: "Nivel de picante",
      min_selections: 1,
      max_selections: 1,
      is_required: false,
      modifiers: [
        { name: "Sin picante", price: 0 },
        { name: "Poco picante", price: 0 },
        { name: "Picante", price: 0 },
        { name: "Muy picante", price: 0 },
      ],
      linkToItems: ["Ceviche Clasico", "Ceviche Mixto", "Tiradito Nikkei", "Lomo Saltado"],
    },
    {
      name: "Tipo de leche",
      min_selections: 1,
      max_selections: 1,
      is_required: false,
      modifiers: [
        { name: "Leche entera", price: 0 },
        { name: "Leche deslactosada", price: 200 },
      ],
      linkToItems: ["Tres Leches"],
    },
  ];

  // Build a map of item names to IDs for linking
  const allCreatedItems = await db.select().from(schema.menuItems).where(eq(schema.menuItems.branch_id, branch.id));
  const itemNameMap = new Map(allCreatedItems.map((i) => [i.name, i.id]));

  let modGroupCount = 0;
  let modCount = 0;
  let linkCount = 0;

  for (const group of modGroups) {
    const [createdGroup] = await db
      .insert(schema.modifierGroups)
      .values({
        branch_id: branch.id,
        organization_id: org.id,
        name: group.name,
        min_selections: group.min_selections,
        max_selections: group.max_selections,
        is_required: group.is_required,
      })
      .returning();
    modGroupCount++;

    for (const mod of group.modifiers) {
      await db.insert(schema.modifiers).values({
        group_id: createdGroup.id,
        name: mod.name,
        price: mod.price,
      });
      modCount++;
    }

    for (const itemName of group.linkToItems) {
      const itemId = itemNameMap.get(itemName);
      if (itemId) {
        await db
          .insert(schema.menuItemModifierGroups)
          .values({ item_id: itemId, group_id: createdGroup.id })
          .onConflictDoNothing();
        linkCount++;
      }
    }
  }

  console.log(`✅ ${modGroupCount} grupos de modificadores, ${modCount} modificadores, ${linkCount} vinculos`);

  // 6c. Create spaces
  const [salon] = await db
    .insert(schema.spaces)
    .values({ branch_id: branch.id, organization_id: org.id, name: "Salon", floor_number: 1, sort_order: 1 })
    .returning();
  const [terraza] = await db
    .insert(schema.spaces)
    .values({ branch_id: branch.id, organization_id: org.id, name: "Terraza", floor_number: 1, sort_order: 2 })
    .returning();
  const [barra] = await db
    .insert(schema.spaces)
    .values({ branch_id: branch.id, organization_id: org.id, name: "Barra", floor_number: 1, sort_order: 3 })
    .returning();

  console.log("✅ 3 espacios creados (Salon, Terraza, Barra)");

  // 7. Create tables (assigned to spaces)
  const tableConfigs = [
    // Salon: mesas 1-6
    { number: 1, capacity: 2, space_id: salon.id },
    { number: 2, capacity: 2, space_id: salon.id },
    { number: 3, capacity: 4, space_id: salon.id },
    { number: 4, capacity: 4, space_id: salon.id },
    { number: 5, capacity: 6, space_id: salon.id },
    { number: 6, capacity: 6, space_id: salon.id },
    // Terraza: mesas 7-10
    { number: 7, capacity: 4, space_id: terraza.id },
    { number: 8, capacity: 4, space_id: terraza.id },
    { number: 9, capacity: 8, space_id: terraza.id },
    { number: 10, capacity: 8, space_id: terraza.id },
    // Barra: mesas 11-14
    { number: 11, capacity: 1, space_id: barra.id },
    { number: 12, capacity: 1, space_id: barra.id },
    { number: 13, capacity: 2, space_id: barra.id },
    { number: 14, capacity: 2, space_id: barra.id },
  ];

  for (const t of tableConfigs) {
    await db.insert(schema.tables).values({
      branch_id: branch.id,
      organization_id: org.id,
      number: t.number,
      capacity: t.capacity,
      space_id: t.space_id,
      qr_code: `demo-principal-T${t.number}-${Date.now().toString(36)}${t.number}`,
      status: "available",
    });
  }

  console.log(`✅ ${tableConfigs.length} mesas creadas (Salon: 6, Terraza: 4, Barra: 4)`);

  // 8. Create loyalty program
  const [program] = await db
    .insert(schema.loyaltyPrograms)
    .values({
      organization_id: org.id,
      name: "Puntos RestAI",
      points_per_currency_unit: 1,
      currency_per_point: 100,
    })
    .returning();

  await db.insert(schema.loyaltyTiers).values([
    { program_id: program.id, name: "Bronce", min_points: 0, multiplier: 100, benefits: {} },
    { program_id: program.id, name: "Plata", min_points: 500, multiplier: 150, benefits: { freeDelivery: true } },
    { program_id: program.id, name: "Oro", min_points: 2000, multiplier: 200, benefits: { freeDelivery: true, prioritySeating: true } },
  ]);

  console.log("✅ Programa de fidelización creado con 3 tiers");

  // 9. Create some inventory categories and items
  const [invCat] = await db
    .insert(schema.inventoryCategories)
    .values({ branch_id: branch.id, organization_id: org.id, name: "Insumos Principales" })
    .returning();

  const inventoryItemsData = [
    { name: "Pescado fresco", unit: "kg", current_stock: "25.000", min_stock: "5.000", cost_per_unit: 3500 },
    { name: "Papas", unit: "kg", current_stock: "50.000", min_stock: "10.000", cost_per_unit: 300 },
    { name: "Arroz", unit: "kg", current_stock: "40.000", min_stock: "8.000", cost_per_unit: 400 },
    { name: "Limones", unit: "kg", current_stock: "15.000", min_stock: "3.000", cost_per_unit: 500 },
    { name: "Cebolla roja", unit: "kg", current_stock: "20.000", min_stock: "5.000", cost_per_unit: 250 },
    { name: "Ají amarillo", unit: "kg", current_stock: "8.000", min_stock: "2.000", cost_per_unit: 800 },
    { name: "Pisco", unit: "lt", current_stock: "12.000", min_stock: "3.000", cost_per_unit: 4500 },
  ];

  for (const item of inventoryItemsData) {
    await db.insert(schema.inventoryItems).values({
      branch_id: branch.id,
      organization_id: org.id,
      category_id: invCat.id,
      ...item,
    });
  }

  console.log(`✅ ${inventoryItemsData.length} items de inventario creados`);

  console.log("\n🎉 Seed completado!");
  console.log("\n📋 Credenciales de acceso:");
  console.log("   Admin:    admin@restai.pe / admin12345");
  console.log("   Gerente:  gerente@restai.pe / gerente123");
  console.log("   Cajero:   cajero@restai.pe / cajero1234");
  console.log("   Mesero:   mesero@restai.pe / mesero1234");
  console.log("   Cocina:   cocina@restai.pe / cocina1234");

  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
