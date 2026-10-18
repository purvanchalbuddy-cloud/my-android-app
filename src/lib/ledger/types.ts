export type Shipment = {
  id: string;
  vehicle: string;
  loading: string;
  unloading: string;
  destination: string;
  shortage: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ShipmentDraft = {
  vehicle: string;
  loading: string;
  unloading: string;
  destination: string;
  shortage: number | null;
};
