import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Plus, 
  Users, 
  Edit3, 
  Trash2, 
  CheckCircle, 
  Layers, 
  Store, 
  X, 
  Armchair,
  Check,
  RefreshCw
} from 'lucide-react';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { DiningTable } from '../types';

export const FloorManagement: React.FC = () => {
  const { selectedBranch } = usePosStore();

  const [tables, setTables] = useState<DiningTable[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<string>('all');

  // Add Table Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [tableNumber, setTableNumber] = useState('');
  const [floorSection, setFloorSection] = useState('Ground Floor');
  const [capacity, setCapacity] = useState(4);
  const [customFloor, setCustomFloor] = useState('');

  // Edit Table Modal
  const [editingTable, setEditingTable] = useState<DiningTable | null>(null);

  // Status Notification
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const predefinedFloors = [
    'Ground Floor',
    '1st Floor (Family)',
    '2nd Floor',
    'Rooftop / Terrace',
    'Outdoor Lawn / Patio',
    'VIP Lounge'
  ];

  const fetchTables = async () => {
    if (!selectedBranch?.id) return;
    try {
      const data = await posApi.getTables(selectedBranch.id);
      setTables(data);
    } catch (err) {
      console.error('Failed to load tables', err);
    }
  };

  useEffect(() => {
    fetchTables();
  }, [selectedBranch?.id]);

  // Extract distinct floors/sections present in the branch
  const existingFloors = Array.from(new Set(tables.map(t => t.section || 'Main Hall')));
  const allFloorsList = Array.from(new Set([...predefinedFloors, ...existingFloors]));

  const filteredTables = selectedFloor === 'all' 
    ? tables 
    : tables.filter(t => (t.section || 'Main Hall') === selectedFloor);

  const handleOpenAdd = () => {
    // Generate smart next table number e.g. T-1, T-2...
    const count = tables.length + 1;
    setTableNumber(`T-${count}`);
    setFloorSection(selectedFloor !== 'all' ? selectedFloor : 'Ground Floor');
    setCapacity(4);
    setCustomFloor('');
    setIsAddModalOpen(true);
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranch?.id || !tableNumber.trim()) return;

    const finalFloor = customFloor.trim() ? customFloor.trim() : floorSection;

    try {
      await posApi.createTable({
        branchId: selectedBranch.id,
        tableNumber: tableNumber.trim().toUpperCase(),
        section: finalFloor,
        capacity: Number(capacity) || 4
      });
      setIsAddModalOpen(false);
      setStatusMsg(`Table ${tableNumber.toUpperCase()} added to ${finalFloor}!`);
      setTimeout(() => setStatusMsg(null), 3500);
      fetchTables();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to add table');
    }
  };

  const handleUpdateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTable) return;

    try {
      await posApi.updateTable(editingTable.id, {
        tableNumber: editingTable.tableNumber,
        section: editingTable.section,
        capacity: editingTable.capacity,
        isOccupied: editingTable.isOccupied
      });
      setEditingTable(null);
      setStatusMsg(`Table ${editingTable.tableNumber} updated successfully!`);
      setTimeout(() => setStatusMsg(null), 3500);
      fetchTables();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to update table');
    }
  };

  const handleDeleteTable = async (table: DiningTable) => {
    if (!window.confirm(`Are you sure you want to remove Table ${table.tableNumber}?`)) return;
    try {
      await posApi.deleteTable(table.id);
      setStatusMsg(`Table ${table.tableNumber} removed.`);
      setTimeout(() => setStatusMsg(null), 3500);
      fetchTables();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete table');
    }
  };

  const handleToggleOccupied = async (table: DiningTable) => {
    try {
      await posApi.updateTable(table.id, {
        isOccupied: !table.isOccupied
      });
      fetchTables();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 text-slate-900 overflow-y-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="w-6 h-6 text-teal-500" />
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Floor & Dining Table Setup</h1>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold border border-slate-200">
              {selectedBranch?.name || 'Branch'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Organize multiple restaurant floors (Ground, Family, Rooftop, Terrace) and manage table capacities &amp; status
          </p>
        </div>

        {statusMsg && (
          <div className="px-4 py-2 bg-teal-50 border border-teal-200 rounded-xl text-teal-600 text-xs font-bold flex items-center gap-2 animate-fadeIn">
            <CheckCircle className="w-4 h-4 text-teal-500" />
            {statusMsg}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={fetchTables}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900"
            title="Refresh tables"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg shadow-teal-500/25 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Dining Table</span>
          </button>
        </div>
      </div>

      {/* Floor Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <button
          onClick={() => setSelectedFloor('all')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
            selectedFloor === 'all'
              ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25 font-black'
              : 'bg-slate-100 text-slate-600 hover:bg-teal-50 border border-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>All Floors ({tables.length})</span>
        </button>

        {existingFloors.map(fl => {
          const count = tables.filter(t => (t.section || 'Main Hall') === fl).length;
          const occupied = tables.filter(t => (t.section || 'Main Hall') === fl && t.isOccupied).length;
          return (
            <button
              key={fl}
              onClick={() => setSelectedFloor(fl)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                selectedFloor === fl
                  ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25 font-black'
                  : 'bg-slate-100 text-slate-600 hover:bg-teal-50 border border-slate-200'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>{fl}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                selectedFloor === fl ? 'bg-white/20 text-white' : 'bg-slate-200 text-teal-600'
              }`}>
                {occupied}/{count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tables Grid Layout */}
      {filteredTables.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl space-y-3">
          <Armchair className="w-10 h-10 text-slate-400 mx-auto" />
          <div className="text-slate-900 font-bold text-sm">No Tables in this Floor/Section</div>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Click &quot;Add Dining Table&quot; above to create new tables with custom seats and assign them to Ground Floor, 1st Floor, Rooftop, or Family Hall.
          </p>
          <button
            onClick={handleOpenAdd}
            className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg shadow-teal-500/25"
          >
            Create Table Now
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredTables.map(t => (
            <div
              key={t.id}
              className={`p-4 rounded-2xl border transition relative flex flex-col justify-between ${
                t.isOccupied
                  ? 'bg-rose-50 border-rose-200'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              } shadow-sm`}
            >
              {/* Header inside Card */}
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${t.isOccupied ? 'bg-rose-500 animate-pulse' : 'bg-teal-500'}`} />
                  <span className="text-[11px] font-bold text-slate-500 truncate max-w-[90px]">
                    {t.section || 'Main Hall'}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingTable({ ...t })}
                    className="p-1 text-slate-400 hover:text-slate-900 rounded hover:bg-slate-100"
                    title="Edit Table"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteTable(t)}
                    className="p-1 text-slate-400 hover:text-rose-500 rounded hover:bg-slate-100"
                    title="Delete Table"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Table Name / Number */}
              <div className="my-2 text-center">
                <div className="text-xl font-black text-slate-900 tracking-tight">{t.tableNumber}</div>
                <div className="flex items-center justify-center gap-1 text-xs text-slate-500 mt-1">
                  <Users className="w-3.5 h-3.5 text-blue-500" />
                  <span>{t.capacity} Seats</span>
                </div>
              </div>

              {/* Occupied toggle status button */}
              <button
                onClick={() => handleToggleOccupied(t)}
                className={`w-full py-1.5 mt-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1.5 ${
                  t.isOccupied
                    ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200'
                    : 'bg-slate-100 hover:bg-teal-50 text-teal-600 border border-slate-200'
                }`}
              >
                {t.isOccupied ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span>Occupied (Busy)</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3 h-3 text-teal-500" />
                    <span>Vacant (Ready)</span>
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* MODAL: ADD DINING TABLE */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleCreateTable}
            className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
                <Armchair className="w-5 h-5" />
                <span>Add Dining Table to Restaurant</span>
              </div>
              <button 
                type="button" 
                onClick={() => setIsAddModalOpen(false)} 
                className="text-slate-400 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Table Identifier / Number
              </label>
              <input
                type="text"
                required
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder="e.g. T-1, Table 05, VIP-1"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 placeholder-slate-400 uppercase focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Floor / Dining Section
              </label>
              <select
                value={floorSection}
                onChange={(e) => setFloorSection(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              >
                {allFloorsList.map(fl => (
                  <option key={fl} value={fl}>{fl}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Or Create New Custom Floor / Hall Name
              </label>
              <input
                type="text"
                value={customFloor}
                onChange={(e) => setCustomFloor(e.target.value)}
                placeholder="e.g. 3rd Floor Banquets, Garden Cabanas"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Seating Capacity (Guests)
              </label>
              <input
                type="number"
                min="1"
                max="50"
                required
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value) || 2)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg shadow-teal-500/25 transition mt-2"
            >
              Add Table to Floor
            </button>
          </form>
        </div>
      )}

      {/* MODAL: EDIT DINING TABLE */}
      {editingTable && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleUpdateTable}
            className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-blue-500 font-bold text-sm">
                <Edit3 className="w-5 h-5" />
                <span>Edit Table {editingTable.tableNumber}</span>
              </div>
              <button 
                type="button" 
                onClick={() => setEditingTable(null)} 
                className="text-slate-400 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Table Identifier / Number
              </label>
              <input
                type="text"
                required
                value={editingTable.tableNumber}
                onChange={(e) => setEditingTable({ ...editingTable, tableNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 uppercase focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Floor / Dining Section
              </label>
              <select
                value={editingTable.section}
                onChange={(e) => setEditingTable({ ...editingTable, section: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              >
                {allFloorsList.map(fl => (
                  <option key={fl} value={fl}>{fl}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Seating Capacity (Guests)
              </label>
              <input
                type="number"
                min="1"
                max="50"
                required
                value={editingTable.capacity}
                onChange={(e) => setEditingTable({ ...editingTable, capacity: Number(e.target.value) || 2 })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-xs font-bold text-slate-700">Occupancy State:</span>
              <button
                type="button"
                onClick={() => setEditingTable({ ...editingTable, isOccupied: !editingTable.isOccupied })}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  editingTable.isOccupied ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-teal-50 text-teal-600 border border-teal-200'
                }`}
              >
                {editingTable.isOccupied ? 'Currently Occupied' : 'Currently Vacant'}
              </button>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-black text-xs shadow-lg transition mt-2"
            >
              Save Table Changes
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
