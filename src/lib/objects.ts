export interface ObjectDef {
  id: string;
  label: string;
  category: "people" | "vehicles" | "animals" | "objects";
  plusOnly: boolean;
}

// Standard objects available with the default Frigate model
const STANDARD_OBJECTS: ObjectDef[] = [
  { id: "person", label: "Person", category: "people", plusOnly: false },
  { id: "car", label: "Car", category: "vehicles", plusOnly: false },
  { id: "motorcycle", label: "Motorcycle", category: "vehicles", plusOnly: false },
  { id: "bicycle", label: "Bicycle", category: "vehicles", plusOnly: false },
  { id: "bus", label: "Bus", category: "vehicles", plusOnly: false },
  { id: "boat", label: "Boat", category: "vehicles", plusOnly: false },
  { id: "cat", label: "Cat", category: "animals", plusOnly: false },
  { id: "dog", label: "Dog", category: "animals", plusOnly: false },
  { id: "bird", label: "Bird", category: "animals", plusOnly: false },
  { id: "horse", label: "Horse", category: "animals", plusOnly: false },
  { id: "cow", label: "Cow", category: "animals", plusOnly: false },
];

// Additional objects only available with Frigate+ models
const PLUS_OBJECTS: ObjectDef[] = [
  { id: "deer", label: "Deer", category: "animals", plusOnly: true },
  { id: "raccoon", label: "Raccoon", category: "animals", plusOnly: true },
  { id: "fox", label: "Fox", category: "animals", plusOnly: true },
  { id: "bear", label: "Bear", category: "animals", plusOnly: true },
  { id: "squirrel", label: "Squirrel", category: "animals", plusOnly: true },
  { id: "rabbit", label: "Rabbit", category: "animals", plusOnly: true },
  { id: "skunk", label: "Skunk", category: "animals", plusOnly: true },
  { id: "goat", label: "Goat", category: "animals", plusOnly: true },
  { id: "school_bus", label: "School Bus", category: "vehicles", plusOnly: true },
  { id: "package", label: "Package", category: "objects", plusOnly: true },
  { id: "waste_bin", label: "Waste Bin", category: "objects", plusOnly: true },
  { id: "robot_lawnmower", label: "Robot Mower", category: "objects", plusOnly: true },
  { id: "umbrella", label: "Umbrella", category: "objects", plusOnly: true },
];

export const ALL_OBJECTS: ObjectDef[] = [...STANDARD_OBJECTS, ...PLUS_OBJECTS];

export const DEFAULT_ENABLED_OBJECTS = ["person", "car", "cat", "dog"];

export function getStandardObjects(): ObjectDef[] {
  return STANDARD_OBJECTS;
}

export function getPlusObjects(): ObjectDef[] {
  return PLUS_OBJECTS;
}

export function getObjectById(id: string): ObjectDef | undefined {
  return ALL_OBJECTS.find((o) => o.id === id);
}

// --- Audio detection labels ---
// These map to Frigate's audio detection (YAMNet model).
// The `id` must match the exact Frigate audio label name.

export interface AudioLabelDef {
  id: string;
  label: string;
  category: "alarm" | "voice" | "animal" | "environment";
}

export const AUDIO_LABELS: AudioLabelDef[] = [
  // Alarms
  { id: "fire_alarm", label: "Fire Alarm", category: "alarm" },
  { id: "car_alarm", label: "Car Alarm", category: "alarm" },
  { id: "siren", label: "Siren", category: "alarm" },
  // Voice
  { id: "scream", label: "Scream", category: "voice" },
  { id: "yell", label: "Yell", category: "voice" },
  { id: "speech", label: "Speech", category: "voice" },
  { id: "crying", label: "Crying", category: "voice" },
  // Animal
  { id: "bark", label: "Dog Bark", category: "animal" },
  // Environment
  { id: "glass", label: "Glass Breaking", category: "environment" },
  { id: "knock", label: "Knock", category: "environment" },
  { id: "gunshot", label: "Gunshot", category: "environment" },
];

export const AUDIO_CATEGORIES = [
  { id: "alarm" as const, label: "Alarms" },
  { id: "voice" as const, label: "Voice" },
  { id: "animal" as const, label: "Animal" },
  { id: "environment" as const, label: "Environment" },
];

export const DEFAULT_ENABLED_AUDIO = ["fire_alarm", "scream", "bark", "glass"];

export function getAudioLabelById(id: string): AudioLabelDef | undefined {
  return AUDIO_LABELS.find((a) => a.id === id);
}
