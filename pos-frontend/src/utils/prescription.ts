// A prescription as the till takes it (Pos.Api Models/PharmacyEntities.cs): who it is for, who wrote
// it and when, and for a controlled medicine the patient's CNIC and the doctor's registration number.
// The same rules as the server's (PrescriptionProblemAsync), so the till asks before the server refuses.
import { today } from './expiry';
import type { CartItem, PrescriptionInput, Product } from '../types';

export const emptyPrescription = (): PrescriptionInput => ({
  patientName: '', patientPhone: '', patientCnic: '', doctorName: '', doctorRegistrationNo: '', prescribedOn: today()
});

/** A CNIC's 13 digits, written with or without dashes; null when it is not one. */
export const normalizeCnic = (value: string | null | undefined) => {
  if (!value || !/^[\d\s-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 13 ? digits : null;
};

/** 35202-1234567-1 */
export const formatCnic = (value: string | null | undefined) => {
  const digits = normalizeCnic(value);
  return digits ? `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}` : value ?? '';
};

/** The medicines in the cart sold on prescription, and which of them are controlled. */
export const prescriptionNeeds = (cart: CartItem[], products: Product[]) => {
  const needing = new Map<string, Product>();
  for (const item of cart) {
    const product = products.find(p => p.id === item.productId);
    if (product && (product.schedule === 'Prescription' || product.schedule === 'Controlled')) needing.set(product.id, product);
  }
  const medicines = [...needing.values()];
  return {
    any: medicines.length > 0,
    names: medicines.map(p => p.name),
    controlledNames: medicines.filter(p => p.schedule === 'Controlled').map(p => p.name)
  };
};

/** What a prescription still lacks for this sale, or null when it is complete. */
export const prescriptionProblem = (rx: PrescriptionInput | null, controlled: boolean): string | null => {
  if (!rx || !rx.patientName.trim() || !rx.doctorName.trim() || !rx.prescribedOn) {
    return 'Enter the patient, the doctor and the date on the prescription.';
  }
  if (rx.prescribedOn > today()) return "The prescription's date cannot be after today.";
  if (controlled) {
    if (!normalizeCnic(rx.patientCnic)) return "A controlled medicine needs the patient's CNIC (13 digits).";
    if (!rx.doctorRegistrationNo.trim()) return "A controlled medicine needs the doctor's registration number.";
  }
  return null;
};

/**
 * A photo of the prescription made small enough to keep with the sale: at most 1280 px on its long
 * side, as a JPEG — a few hundred KB, from a phone camera's several MB.
 */
export const shrinkPhoto = (file: File, maxSide = 1280, quality = 0.7) =>
  new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('This browser cannot prepare the photo.'));
        return;
      }
      ctx.fillStyle = '#ffffff'; // a transparent PNG would otherwise turn black as a JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a picture this browser can open.'));
    };
    img.src = url;
  });
