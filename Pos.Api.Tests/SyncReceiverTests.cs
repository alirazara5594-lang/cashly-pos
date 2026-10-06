using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Models;
using Xunit;

namespace Pos.Api.Tests;

/// <summary>
/// What head office does when a business host posts a batch. These are the tests that matter
/// most: every one of them is a way a sale could be lost between the till and the cloud, and
/// losing a sale is the only unrecoverable failure a POS can have.
/// </summary>
public class SyncReceiverTests
{
    private static Dictionary<string, JsonElement> OrderRecord(
        TestDatabase db, Guid id, Guid productId, string orderNumber = "ORD-TEST-0001") =>
        Record.Of(new
        {
            id,
            clientLocalId = $"local-{id:N}",
            branchId = db.BranchId,
            orderNumber,
            orderType = "DineIn",
            status = "Completed",
            subTotalPKR = 650,
            discountPKR = 0,
            taxPKR = 0,
            totalPKR = 650,
            paymentMethod = "Cash",
            amountPaidPKR = 700,
            changeDuePKR = 50,
            isPaid = true,
            cashierName = "Ali",
            createdAt = "2026-01-01T10:00:00Z",
            items = new[]
            {
                new
                {
                    id = Guid.NewGuid(),
                    productId,
                    productName = "Zinger Burger",
                    quantity = 1,
                    unitPricePKR = 650,
                    totalPricePKR = 650
                }
            }
        });

    [Fact]
    public async Task Order_is_persisted_with_its_lines()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var product = db.SeedProduct();
        var orderId = Guid.NewGuid();

        var result = await db.Receiver.ReceiveAsync(
            db.TenantId, "Order", Record.Batch(OrderRecord(db, orderId, product)));

        Assert.Equal(1, result.NewRecords);
        Assert.Equal(0, result.Duplicates);
        Assert.Equal(0, result.Rejected);

        var order = await db.Db.Orders.AsNoTracking()
            .Include(o => o.Items)
            .SingleAsync(o => o.Id == orderId);

        // Forced, not taken from the wire: the host vouched for this tenant, and that is the
        // only say the record itself gets.
        Assert.Equal(db.TenantId, order.TenantId);
        Assert.Equal(db.BranchId, order.BranchId);
        Assert.Equal(650m, order.TotalPKR);
        Assert.True(order.IsPaid);
        Assert.Single(order.Items);
        Assert.Equal(product, order.Items.Single().ProductId);
        // Wall-clock, not a local time: SQLite stores no offset, so the instant comes back with
        // Kind Unspecified and converting it here would move it by the test machine's timezone.
        Assert.Equal(new DateTime(2026, 1, 1, 10, 0, 0), order.CreatedAt);
    }

    [Fact]
    public async Task Replaying_the_same_batch_counts_duplicates_and_stores_nothing_twice()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var product = db.SeedProduct();
        var orderId = Guid.NewGuid();
        var batch = Record.Batch(OrderRecord(db, orderId, product));

        var first = await db.Receiver.ReceiveAsync(db.TenantId, "Order", batch);
        var second = await db.Receiver.ReceiveAsync(db.TenantId, "Order", batch);

        Assert.Equal(1, first.NewRecords);
        Assert.Equal(0, second.NewRecords);
        Assert.Equal(1, second.Duplicates);
        Assert.Equal(1, await db.Db.Orders.AsNoTracking().CountAsync());
    }

    [Fact]
    public async Task A_sale_against_another_business_s_branch_is_rejected_not_stored()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var product = db.SeedProduct();

        var record = Record.Of(new
        {
            id = Guid.NewGuid(),
            branchId = db.ForeignBranchId, // belongs to a different tenant
            orderNumber = "ORD-TEST-0001",
            totalPKR = 100
        });

        var result = await db.Receiver.ReceiveAsync(db.TenantId, "Order", Record.Batch(record));

        Assert.Equal(1, result.Rejected);
        Assert.Equal(0, result.NewRecords);
        Assert.Contains("branch not in this business", result.RejectionSummary ?? string.Empty);
        Assert.Empty(await db.Db.Orders.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task An_order_number_collision_is_renumbered_rather_than_lost()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var product = db.SeedProduct();

        var series = $"ORD-{DateTime.UtcNow:yyMMdd}";
        var taken = $"{series}-0001";
        var existingId = Guid.NewGuid();
        db.Db.Orders.Add(new Order
        {
            Id = existingId,
            TenantId = db.TenantId,
            BranchId = db.BranchId,
            OrderNumber = taken,
            TotalPKR = 100m
        });
        await db.Db.SaveChangesAsync();

        var orderId = Guid.NewGuid();
        var result = await db.Receiver.ReceiveAsync(
            db.TenantId, "Order", Record.Batch(OrderRecord(db, orderId, product, taken)));

        Assert.Equal(1, result.NewRecords);
        Assert.Equal(0, result.Rejected);

        var orders = await db.Db.Orders.AsNoTracking().ToListAsync();
        Assert.Equal(2, orders.Count);
        Assert.Equal(taken, orders.Single(o => o.Id == existingId).OrderNumber);
        Assert.NotEqual(taken, orders.Single(o => o.Id == orderId).OrderNumber);
        Assert.StartsWith($"{series}-", orders.Single(o => o.Id == orderId).OrderNumber);
    }

    [Fact]
    public async Task An_item_whose_product_head_office_never_saw_gets_a_placeholder()
    {
        using var db = new TestDatabase();
        db.SeedTenant();

        var orderId = Guid.NewGuid();
        var record = Record.Of(new
        {
            id = orderId,
            branchId = db.BranchId,
            orderNumber = "ORD-TEST-0001",
            totalPKR = 420,
            items = new[]
            {
                new
                {
                    id = Guid.NewGuid(),
                    productId = Guid.NewGuid(), // no such product here
                    productName = "Mango Lassi",
                    quantity = 2,
                    unitPricePKR = 210,
                    totalPricePKR = 420
                }
            }
        });

        var result = await db.Receiver.ReceiveAsync(db.TenantId, "Order", Record.Batch(record));

        Assert.Equal(1, result.NewRecords);
        Assert.Equal(0, result.Rejected);

        var line = (await db.Db.Orders.AsNoTracking()
                .Include(o => o.Items)
                .SingleAsync(o => o.Id == orderId))
            .Items.Single();

        var product = await db.Db.Products.AsNoTracking().SingleAsync(p => p.Id == line.ProductId);
        Assert.Equal("Mango Lassi", product.Name);
        Assert.Equal(210m, product.SellingPricePKR); // the unit, not the line total

        var category = await db.Db.Categories.AsNoTracking().SingleAsync(c => c.Id == product.CategoryId);
        Assert.Equal("Synced items", category.Name);
    }

    [Fact]
    public async Task An_entity_type_this_build_does_not_know_is_accepted_not_rejected()
    {
        using var db = new TestDatabase();
        db.SeedTenant();

        // A host running a newer build must never wedge retrying a batch this cloud has no
        // table for. Accepting it costs one row we ignore; rejecting it costs every later sale.
        var result = await db.Receiver.ReceiveAsync(
            db.TenantId, "SomethingFromTheFuture", Record.Batch(Record.Of(new { id = Guid.NewGuid() })));

        Assert.Equal(1, result.Accepted);
        Assert.Equal(0, result.Rejected);
        Assert.Empty(result.Reasons);
    }

    [Fact]
    public async Task An_expense_is_persisted()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var id = Guid.NewGuid();

        var record = Record.Of(new
        {
            id,
            branchId = db.BranchId,
            expenseNumber = "EXP-0001",
            category = "Utilities",
            description = "Electricity",
            amountPKR = 12000,
            totalPKR = 12000,
            status = "Approved",
            expenseDate = "2026-01-02T00:00:00Z"
        });

        var result = await db.Receiver.ReceiveAsync(db.TenantId, "Expense", Record.Batch(record));

        Assert.Equal(1, result.NewRecords);
        var expense = await db.Db.Expenses.AsNoTracking().SingleAsync(e => e.Id == id);
        Assert.Equal("EXP-0001", expense.ExpenseNumber);
        Assert.Equal(12000m, expense.TotalPKR);
        Assert.Equal(ExpenseStatus.Approved, expense.Status);
    }

    [Fact]
    public async Task A_closed_shift_is_persisted()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var id = Guid.NewGuid();

        var record = Record.Of(new
        {
            id,
            branchId = db.BranchId,
            terminalName = "Till 1",
            cashierName = "Ali",
            openedAt = "2026-01-02T09:00:00Z",
            closedAt = "2026-01-02T17:00:00Z",
            openingFloatPKR = 5000,
            cashSalesPKR = 20000,
            expectedCashPKR = 25000,
            actualCashCountedPKR = 24900,
            variancePKR = -100
        });

        var result = await db.Receiver.ReceiveAsync(db.TenantId, "CashShift", Record.Batch(record));

        Assert.Equal(1, result.NewRecords);
        var shift = await db.Db.CashShifts.AsNoTracking().SingleAsync(s => s.Id == id);
        Assert.Equal(db.BranchId, shift.BranchId);
        Assert.Equal(-100m, shift.VariancePKR);
        Assert.True(shift.IsClosed);
    }

    /// <summary>
    /// The model used to declare CashShift.BranchId as a foreign key to CashShifts.Id, which
    /// asked the database to reject every shift a till ever opened. Asserted against the model
    /// rather than against SQLite's enforcement, so the test fails on the bug even where FK
    /// checking is off.
    /// </summary>
    [Fact]
    public void A_shift_belongs_to_a_branch_not_to_another_shift()
    {
        using var db = new TestDatabase();
        var entity = db.Db.Model.FindEntityType(typeof(CashShift))!;

        var branchFk = entity.GetForeignKeys()
            .Single(fk => fk.Properties.Any(p => p.Name == nameof(CashShift.BranchId)));

        Assert.Equal(typeof(Branch), branchFk.PrincipalEntityType.ClrType);
        Assert.DoesNotContain(
            entity.GetForeignKeys(),
            fk => fk.PrincipalEntityType.ClrType == typeof(CashShift));
    }

    [Fact]
    public async Task A_stock_movement_whose_ingredient_is_unknown_keeps_the_numbers()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var id = Guid.NewGuid();

        var record = Record.Of(new
        {
            id,
            branchId = db.BranchId,
            ingredientId = Guid.NewGuid(), // head office has never heard of it
            movementType = "Adjustment",
            quantityChange = -3,
            unitCostPKR = 45,
            balanceAfter = 17,
            notes = "Weekly count",
            createdBy = "Ali",
            createdAt = "2026-01-02T12:00:00Z"
        });

        var result = await db.Receiver.ReceiveAsync(db.TenantId, "StockLedgerEntry", Record.Batch(record));

        Assert.Equal(1, result.NewRecords);
        var entry = await db.Db.StockLedgerEntries.AsNoTracking().SingleAsync(s => s.Id == id);

        Assert.Null(entry.IngredientId);
        Assert.Equal(-3m, entry.QuantityChange);
        Assert.Equal(17m, entry.BalanceAfter);
        var notes = entry.Notes ?? string.Empty;
        Assert.Equal("Weekly count", notes.Split('[')[0].TrimEnd());
        Assert.Contains("unknown", notes);
    }

    [Fact]
    public async Task A_batch_is_all_or_nothing_when_a_line_cannot_be_read()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var product = db.SeedProduct();

        // The record with no id is rejected; the good one still lands. The point of one
        // SaveChanges per batch is that a mid-batch failure can never leave an order without
        // its lines — the pairing that matters is order/lines, not good-record/bad-record.
        var good = OrderRecord(db, Guid.NewGuid(), product);
        var bad = Record.Of(new { branchId = db.BranchId, orderNumber = "ORD-TEST-0002" });

        var result = await db.Receiver.ReceiveAsync(db.TenantId, "Order", Record.Batch(good, bad));

        Assert.Equal(1, result.NewRecords);
        Assert.Equal(1, result.Rejected);
        Assert.Equal(1, await db.Db.Orders.AsNoTracking().CountAsync());
        Assert.Equal(1, await db.Db.OrderItems.AsNoTracking().CountAsync());
    }
}
