using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Models;

namespace Pos.Api.Data;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        await db.Database.EnsureCreatedAsync();

        if (await db.Tenants.AnyAsync())
        {
            return; // Already seeded
        }

        // 1. Seed Tenants
        var chainRestaurant = new Tenant
        {
            Id = Guid.Parse("11111111-1111-1111-1111-111111111111"),
            Name = "Royal Grill & Kitchen (Multi-Branch Chain)",
            BusinessType = BusinessType.Restaurant,
            Tier = SubscriptionTier.Professional,
            IsActive = true
        };

        var singleRestaurant = new Tenant
        {
            Id = Guid.Parse("22222222-2222-2222-2222-222222222222"),
            Name = "Spice Bistro (Single Location)",
            BusinessType = BusinessType.Restaurant,
            Tier = SubscriptionTier.Standard,
            IsActive = true
        };

        db.Tenants.AddRange(chainRestaurant, singleRestaurant);

        // 2. Seed Branches
        var chainHO = new Branch
        {
            Id = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            TenantId = chainRestaurant.Id,
            Name = "Royal Grill Head Office & Commissary",
            Code = "RG-HO",
            Address = "Blue Area, Jinnah Avenue",
            City = "Islamabad",
            Phone = "051-111-443-443",
            IsHeadOffice = true,
            AllowedCounters = 10,
            AllowedOrderTabs = 25
        };

        var chainDowntown = new Branch
        {
            Id = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            TenantId = chainRestaurant.Id,
            Name = "Royal Grill - Downtown Branch",
            Code = "RG-DT",
            Address = "Sector F-7 Markaz",
            City = "Islamabad",
            Phone = "051-2651122",
            IsHeadOffice = false,
            AllowedCounters = 5,
            AllowedOrderTabs = 15
        };

        var chainUptown = new Branch
        {
            Id = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
            TenantId = chainRestaurant.Id,
            Name = "Royal Grill - Uptown Branch",
            Code = "RG-UT",
            Address = "Main Boulevard, Gulberg III",
            City = "Lahore",
            Phone = "042-3578912",
            IsHeadOffice = false,
            AllowedCounters = 5,
            AllowedOrderTabs = 15
        };

        var singleBranch = new Branch
        {
            Id = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"),
            TenantId = singleRestaurant.Id,
            Name = "Spice Bistro - Main Dining",
            Code = "SB-01",
            Address = "F-11 Markaz",
            City = "Islamabad",
            Phone = "051-2287654",
            IsHeadOffice = false, // Independent single restaurant without Head Office or central warehouse
            AllowedCounters = 3,
            AllowedOrderTabs = 6
        };

        db.Branches.AddRange(chainHO, chainDowntown, chainUptown, singleBranch);

        // 3. Seed Terminals
        db.Terminals.AddRange(
            new Terminal { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, TerminalName = "Counter 1 - Fast Checkout", TerminalType = TerminalType.Counter },
            new Terminal { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, TerminalName = "Counter 2 - Takeaway/Call", TerminalType = TerminalType.Counter },
            new Terminal { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, TerminalName = "Order Tab 1 - Ground Hall", TerminalType = TerminalType.OrderTab },
            new Terminal { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, TerminalName = "Order Tab 2 - Terrace Lounge", TerminalType = TerminalType.OrderTab },
            new Terminal { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, TerminalName = "Kitchen Screen - Main Line", TerminalType = TerminalType.KitchenDisplay },
            new Terminal { Id = Guid.NewGuid(), BranchId = singleBranch.Id, TerminalName = "Counter POS 1", TerminalType = TerminalType.Counter },
            new Terminal { Id = Guid.NewGuid(), BranchId = singleBranch.Id, TerminalName = "Kitchen Screen", TerminalType = TerminalType.KitchenDisplay }
        );

        // 4. Seed Riders
        var riderTariq = new Rider { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, Name = "Tariq Khan", Phone = "0301-5551234", VehicleNumber = "ICT-LE-4590", IsAvailable = true };
        var riderBilal = new Rider { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, Name = "Bilal Ahmed", Phone = "0333-8889922", VehicleNumber = "RWP-7721", IsAvailable = true };
        var riderUsman = new Rider { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, Name = "Usman Ali", Phone = "0345-1237890", VehicleNumber = "ICT-MN-1102", IsAvailable = true };
        db.Riders.AddRange(riderTariq, riderBilal, riderUsman);

        // 5. Seed Tables
        for (int i = 1; i <= 8; i++)
        {
            db.DiningTables.Add(new DiningTable
            {
                Id = Guid.NewGuid(),
                BranchId = chainDowntown.Id,
                TableNumber = $"T-{i}",
                Section = i <= 4 ? "Indoor Dining" : "Family Lounge",
                Capacity = i % 2 == 0 ? 6 : 4,
                IsOccupied = i == 2 || i == 5
            });
        }

        // Seed Dining Tables for Single Independent Restaurant
        for (int i = 1; i <= 6; i++)
        {
            db.DiningTables.Add(new DiningTable
            {
                Id = Guid.NewGuid(),
                BranchId = singleBranch.Id,
                TableNumber = $"Table-{i}",
                Section = "Main Dining Room",
                Capacity = 4,
                IsOccupied = i == 1
            });
        }

        // 6. Seed Categories
        var catPizza = new Category { Id = Guid.NewGuid(), TenantId = chainRestaurant.Id, Name = "Pizzas & Calzones", Icon = "pizza", SortOrder = 1 };
        var catBurgers = new Category { Id = Guid.NewGuid(), TenantId = chainRestaurant.Id, Name = "Burgers & Sandwiches", Icon = "burger", SortOrder = 2 };
        var catSides = new Category { Id = Guid.NewGuid(), TenantId = chainRestaurant.Id, Name = "Sides & Appetizers", Icon = "french-fries", SortOrder = 3 };
        var catBeverages = new Category { Id = Guid.NewGuid(), TenantId = chainRestaurant.Id, Name = "Beverages & Shakes", Icon = "coffee", SortOrder = 4 };
        var catDeals = new Category { Id = Guid.NewGuid(), TenantId = chainRestaurant.Id, Name = "Exclusive Deals", Icon = "gift", SortOrder = 5 };
        var catSingleWraps = new Category { Id = Guid.NewGuid(), TenantId = singleRestaurant.Id, Name = "Wraps & Grills", Icon = "sandwich", SortOrder = 1 };

        db.Categories.AddRange(catPizza, catBurgers, catSides, catBeverages, catDeals, catSingleWraps);

        // 7. Seed Products
        var p1 = new Product
        {
            Id = Guid.NewGuid(),
            TenantId = chainRestaurant.Id,
            CategoryId = catPizza.Id,
            SKU = "RG-PIZ-01",
            Barcode = "8964000101",
            Name = "Crown Crust Pizza (Large)",
            UrduName = "کراؤن کرسٹ پیزا",
            Description = "Signature stuffed crust with kebabs and special cheese sauce",
            CostPricePKR = 850,
            SellingPricePKR = 1750,
            Unit = "Piece",
            Station = KitchenStation.MainKitchen,
            ImageUrl = "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400"
        };

        var p2 = new Product
        {
            Id = Guid.NewGuid(),
            TenantId = chainRestaurant.Id,
            CategoryId = catPizza.Id,
            SKU = "RG-PIZ-02",
            Barcode = "8964000102",
            Name = "Bihari Kebab Pizza (Regular)",
            UrduName = "بہاری کباب پیزا",
            Description = "Tender Bihari chunks, onions, jalapenos and creamy garlic ranch",
            CostPricePKR = 550,
            SellingPricePKR = 1250,
            Unit = "Piece",
            Station = KitchenStation.MainKitchen,
            ImageUrl = "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400"
        };

        var p3 = new Product
        {
            Id = Guid.NewGuid(),
            TenantId = chainRestaurant.Id,
            CategoryId = catBurgers.Id,
            SKU = "RG-BGR-01",
            Barcode = "8964000201",
            Name = "Zinger Supreme Burger",
            UrduName = "زنگر سپریم برگر",
            Description = "Crispy spiced chicken breast, iceburg lettuce, signature mayo in sesame bun",
            CostPricePKR = 320,
            SellingPricePKR = 690,
            Unit = "Piece",
            Station = KitchenStation.Grill,
            ImageUrl = "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400"
        };

        var p4 = new Product
        {
            Id = Guid.NewGuid(),
            TenantId = chainRestaurant.Id,
            CategoryId = catSides.Id,
            SKU = "RG-SDE-01",
            Barcode = "8964000301",
            Name = "Cheesy Loaded Fries",
            UrduName = "چیزی لوڈڈ فرائیز",
            Description = "Crisp golden fries topped with melted mozzarella, jalapenos, and chipotle",
            CostPricePKR = 210,
            SellingPricePKR = 490,
            Unit = "Plate",
            Station = KitchenStation.Grill,
            ImageUrl = "https://images.unsplash.com/photo-1576107232684-1279f3908594?w=400"
        };

        var p5 = new Product
        {
            Id = Guid.NewGuid(),
            TenantId = chainRestaurant.Id,
            CategoryId = catBeverages.Id,
            SKU = "RG-BEV-01",
            Barcode = "8964000401",
            Name = "Fresh Mint Margarita",
            UrduName = "منٹ مارگریٹا",
            Description = "Refreshing blend of fresh mint leaves, lemon juice and sprite",
            CostPricePKR = 90,
            SellingPricePKR = 290,
            Unit = "Glass",
            Station = KitchenStation.BeverageBar,
            ImageUrl = "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=400"
        };

        var p6 = new Product
        {
            Id = Guid.NewGuid(),
            TenantId = chainRestaurant.Id,
            CategoryId = catDeals.Id,
            SKU = "RG-DEL-01",
            Barcode = "8964000501",
            Name = "Grand Family Feast",
            UrduName = "گرینڈ فیملی فیسٹ",
            Description = "2 Large Pizzas + 1 Zinger Burger + 1.5L Drink + Loaded Fries",
            CostPricePKR = 1950,
            SellingPricePKR = 3850,
            Unit = "Combo",
            Station = KitchenStation.MainKitchen,
            ImageUrl = "https://images.unsplash.com/photo-1550547660-d9450f859349?w=400"
        };

        // Single Independent Restaurant Products
        var p7 = new Product
        {
            Id = Guid.NewGuid(),
            TenantId = singleRestaurant.Id,
            CategoryId = catSingleWraps.Id,
            SKU = "SB-WRP-01",
            Barcode = "896101112233",
            Name = "Crispy Chicken Wrap",
            UrduName = "کرسپی چکن ریپ",
            Description = "Crispy spiced chicken rolled in tortilla with garlic sauce and greens",
            CostPricePKR = 280,
            SellingPricePKR = 620,
            Unit = "Piece",
            Station = KitchenStation.Grill,
            ImageUrl = "https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=400"
        };

        var p8 = new Product
        {
            Id = Guid.NewGuid(),
            TenantId = singleRestaurant.Id,
            CategoryId = catSingleWraps.Id,
            SKU = "SB-BBQ-01",
            Barcode = "896101112244",
            Name = "Smoky BBQ Platter",
            UrduName = "اسمونکی بی بی کیو پلیٹر",
            Description = "Flame-grilled succulent chicken skewers with mint chutney and fresh paratha",
            CostPricePKR = 520,
            SellingPricePKR = 1150,
            Unit = "Platter",
            Station = KitchenStation.Grill,
            ImageUrl = "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400"
        };

        db.Products.AddRange(p1, p2, p3, p4, p5, p6, p7, p8);

        // 8. Modifiers
        db.ProductModifiers.AddRange(
            new ProductModifier { Id = Guid.NewGuid(), ProductId = p1.Id, Name = "Extra Cheese Layer", PricePKR = 250 },
            new ProductModifier { Id = Guid.NewGuid(), ProductId = p1.Id, Name = "Dip Sauce (Garlic Mayo)", PricePKR = 100 },
            new ProductModifier { Id = Guid.NewGuid(), ProductId = p3.Id, Name = "Add Cheese Slice", PricePKR = 80 },
            new ProductModifier { Id = Guid.NewGuid(), ProductId = p3.Id, Name = "Double Patty", PricePKR = 250 },
            new ProductModifier { Id = Guid.NewGuid(), ProductId = p7.Id, Name = "Add Jalapeno & Cheese", PricePKR = 90 }
        );

        // 9. Stock Levels
        db.BranchStocks.AddRange(
            new BranchStock { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, ProductId = p1.Id, QuantityOnHand = 120 },
            new BranchStock { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, ProductId = p2.Id, QuantityOnHand = 95 },
            new BranchStock { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, ProductId = p3.Id, QuantityOnHand = 250 },
            new BranchStock { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, ProductId = p4.Id, QuantityOnHand = 180 },
            new BranchStock { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, ProductId = p5.Id, QuantityOnHand = 300 },
            new BranchStock { Id = Guid.NewGuid(), BranchId = chainDowntown.Id, ProductId = p6.Id, QuantityOnHand = 50 },
            new BranchStock { Id = Guid.NewGuid(), BranchId = singleBranch.Id, ProductId = p7.Id, QuantityOnHand = 75 },
            new BranchStock { Id = Guid.NewGuid(), BranchId = singleBranch.Id, ProductId = p8.Id, QuantityOnHand = 60 }
        );

        // 10. Sample Active Shift
        var shift = new CashShift
        {
            Id = Guid.NewGuid(),
            BranchId = chainDowntown.Id,
            TerminalName = "Counter 1 - Fast Checkout",
            CashierName = "Hamza POS",
            OpenedAt = DateTime.UtcNow.AddHours(-4),
            OpeningFloatPKR = 10000,
            CashSalesPKR = 48500,
            ExpectedCashPKR = 58500,
            ActualCashCountedPKR = 0,
            VariancePKR = 0,
            IsClosed = false
        };
        db.CashShifts.Add(shift);

        // 11. Sample Orders across stages (Kitchen, Ready, Out for Delivery)
        var order1 = new Order
        {
            Id = Guid.NewGuid(),
            TenantId = chainRestaurant.Id,
            BranchId = chainDowntown.Id,
            OrderNumber = "ORD-101",
            OrderType = OrderType.DineIn,
            Status = OrderStatus.InKitchen,
            TableNumber = "T-2",
            SubTotalPKR = 2440,
            DiscountPKR = 0,
            TaxPKR = 390,
            TotalPKR = 2830,
            PaymentMethod = PaymentMethod.Cash,
            IsPaid = false,
            CashierName = "Hamza POS",
            CreatedByRole = "WaiterTab",
            CreatedAt = DateTime.UtcNow.AddMinutes(-12)
        };

        order1.Items.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order1.Id,
            ProductId = p1.Id,
            ProductName = "Crown Crust Pizza (Large)",
            Quantity = 1,
            UnitPricePKR = 1750,
            TotalPricePKR = 1750,
            Station = KitchenStation.MainKitchen,
            SpecialNotes = "Well done crust"
        });

        order1.Items.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order1.Id,
            ProductId = p3.Id,
            ProductName = "Zinger Supreme Burger",
            Quantity = 1,
            UnitPricePKR = 690,
            TotalPricePKR = 690,
            Station = KitchenStation.Grill,
            SpecialNotes = "Extra spicy"
        });

        var order2 = new Order
        {
            Id = Guid.NewGuid(),
            TenantId = chainRestaurant.Id,
            BranchId = chainDowntown.Id,
            OrderNumber = "ORD-102",
            OrderType = OrderType.Delivery,
            Status = OrderStatus.OutForDelivery,
            CustomerName = "Dr. Asim Farooq",
            CustomerPhone = "0321-9876543",
            DeliveryAddress = "House 45, Street 12, Sector F-7/2, Islamabad",
            AssignedRiderId = riderTariq.Id,
            SubTotalPKR = 3850,
            DiscountPKR = 200,
            TaxPKR = 584,
            TotalPKR = 4234,
            PaymentMethod = PaymentMethod.Cash,
            AmountPaidPKR = 0,
            IsPaid = false,
            CashierName = "Hamza POS",
            CreatedByRole = "CallCenter",
            CreatedAt = DateTime.UtcNow.AddMinutes(-35)
        };

        order2.Items.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order2.Id,
            ProductId = p6.Id,
            ProductName = "Grand Family Feast",
            Quantity = 1,
            UnitPricePKR = 3850,
            TotalPricePKR = 3850,
            Station = KitchenStation.MainKitchen
        });

        var order3 = new Order
        {
            Id = Guid.NewGuid(),
            TenantId = chainRestaurant.Id,
            BranchId = chainDowntown.Id,
            OrderNumber = "ORD-103",
            OrderType = OrderType.Takeaway,
            Status = OrderStatus.ReadyForDispatch,
            CustomerName = "Kamran POS Walk-in",
            CustomerPhone = "0300-1122334",
            SubTotalPKR = 1250,
            DiscountPKR = 0,
            TaxPKR = 200,
            TotalPKR = 1450,
            PaymentMethod = PaymentMethod.Card,
            AmountPaidPKR = 1450,
            IsPaid = true,
            CashierName = "Hamza POS",
            CreatedByRole = "Cashier",
            CreatedAt = DateTime.UtcNow.AddMinutes(-8)
        };

        order3.Items.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order3.Id,
            ProductId = p2.Id,
            ProductName = "Bihari Kebab Pizza (Regular)",
            Quantity = 1,
            UnitPricePKR = 1250,
            TotalPricePKR = 1250,
            Station = KitchenStation.MainKitchen
        });

        db.Orders.AddRange(order1, order2, order3);

        // KOTs
        db.KitchenTickets.AddRange(
            new KitchenTicket
            {
                Id = Guid.NewGuid(),
                OrderId = order1.Id,
                BranchId = chainDowntown.Id,
                TicketNumber = "KOT-101",
                Station = KitchenStation.MainKitchen,
                Status = "Cooking",
                CreatedAt = DateTime.UtcNow.AddMinutes(-12)
            },
            new KitchenTicket
            {
                Id = Guid.NewGuid(),
                OrderId = order3.Id,
                BranchId = chainDowntown.Id,
                TicketNumber = "KOT-103",
                Station = KitchenStation.MainKitchen,
                Status = "Ready",
                CreatedAt = DateTime.UtcNow.AddMinutes(-8)
            }
        );

        await db.SaveChangesAsync();
    }
}
