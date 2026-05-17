import {
  Archive,
  BookOpen,
  Briefcase,
  Calendar,
  Code,
  FileText,
  Flag,
  Folder,
  FolderOpen,
  Globe,
  GraduationCap,
  Heart,
  House,
  Image,
  Inbox,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Mail,
  Music,
  Rocket,
  Star,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { type FolderIcon as FolderIconKey, isFolderIcon } from '@/lib/notes/folder-icons.ts';

/** Curated key → Lucide component. Named imports keep the bundle tree-shaken. */
const ICON_COMPONENTS: Record<FolderIconKey, LucideIcon> = {
  folder: Folder,
  'folder-open': FolderOpen,
  briefcase: Briefcase,
  house: House,
  user: User,
  users: Users,
  star: Star,
  archive: Archive,
  inbox: Inbox,
  'file-text': FileText,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  code: Code,
  rocket: Rocket,
  lightbulb: Lightbulb,
  calendar: Calendar,
  'list-checks': ListChecks,
  heart: Heart,
  flag: Flag,
  image: Image,
  music: Music,
  wallet: Wallet,
  globe: Globe,
  mail: Mail,
};

type Props = {
  /** A folder-icon key. An unrecognised value falls back to the folder icon. */
  icon: string;
  /** Extra classes for the rendered SVG (size, colour). */
  className?: string;
};

/**
 * Renders a folder's Lucide icon from its stored key. Presentational and
 * `aria-hidden` — the accessible name comes from the surrounding control.
 */
export function FolderIcon({ icon, className }: Props) {
  const key: FolderIconKey = isFolderIcon(icon) ? icon : 'folder';
  const Glyph = ICON_COMPONENTS[key];
  return <Glyph aria-hidden="true" className={className} />;
}
