using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace GuardrailScanning {
    public sealed class FileRecord {
        public string RelativePath { get; set; }
        public string Type { get; set; }
        public long Bytes { get; set; }
        public string ModifiedAt { get; set; }
    }
    public sealed class TypeRecord {
        public string Type { get; set; }
        public int Count { get; set; }
        public long Bytes { get; set; }
    }
    public sealed class ScanReport {
        public string ScanId { get; set; }
        public string FolderName { get; set; }
        public string StartedAt { get; set; }
        public string FinishedAt { get; set; }
        public int FileCount { get; set; }
        public long TotalBytes { get; set; }
        public int SkippedCount { get; set; }
        public bool LimitReached { get; set; }
        public List<FileRecord> LargestFiles { get; set; }
        public List<TypeRecord> Types { get; set; }
    }
    public sealed class ScanJob : IDisposable {
        private readonly CancellationTokenSource cancellation;
        public Task<ScanReport> Completion { get; private set; }
        public int Files { get { return Volatile.Read(ref files); } }
        public int Skipped { get { return Volatile.Read(ref skipped); } }
        public long Bytes { get { return Interlocked.Read(ref bytes); } }
        private int files, skipped;
        private long bytes;
        private int disposed;
        private const long SafeInteger = 9007199254740991L;
        private static readonly HashSet<string> Excluded = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            ".git", ".ssh", ".aws", ".azure", ".codex", ".agents", ".gnupg", "node_modules", "$RECYCLE.BIN", "System Volume Information"
        };
        public ScanJob(string input, CancellationTokenSource external) {
            string root = ValidateRoot(input);
            cancellation = external == null ? new CancellationTokenSource() : CancellationTokenSource.CreateLinkedTokenSource(external.Token);
            Completion = Task.Run(() => Scan(root, cancellation.Token), cancellation.Token);
        }
        public void Cancel() { if (Volatile.Read(ref disposed) == 0) cancellation.Cancel(); }
        public void Dispose() {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            cancellation.Cancel();
            Completion.ContinueWith(task => cancellation.Dispose());
        }
        private static string Clean(string value, int max) {
            return new string(value.Where(c => c >= 32 && c != 127).Take(max).ToArray()).Trim();
        }
        private static bool Within(string path, string root) {
            return path.Equals(root, StringComparison.OrdinalIgnoreCase) || path.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
        }
        private static bool ExcludedName(string name) {
            return Excluded.Contains(name) || name.StartsWith(".env", StringComparison.OrdinalIgnoreCase) || new[] { ".pem", ".key", ".pfx", ".p12" }.Contains(Path.GetExtension(name).ToLowerInvariant());
        }
        private static bool ProtectedPath(string path) {
            var roots = new[] { Environment.GetFolderPath(Environment.SpecialFolder.Windows), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Guardrail") };
            return roots.Any(root => !String.IsNullOrEmpty(root) && Within(path, root.TrimEnd('\\')));
        }
        public static string ValidateRoot(string input) {
            if (String.IsNullOrWhiteSpace(input) || input.StartsWith(@"\\") || input.IndexOf(':') != 1) throw new ArgumentException("Choose a local folder, not a volume root or network path.");
            string root = Path.GetFullPath(input).TrimEnd('\\');
            if (root.Length <= 3 || !Directory.Exists(root)) throw new ArgumentException("Choose an existing local subfolder.");
            if (new DriveInfo(Path.GetPathRoot(root)).DriveType != DriveType.Fixed) throw new ArgumentException("Choose a fixed local drive.");
            if (ProtectedPath(root)) throw new ArgumentException("Choose a personal folder outside system and app credential folders.");
            string current = root;
            while (current.Length > 3) {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0 || ExcludedName(Path.GetFileName(current))) throw new ArgumentException("Linked or excluded folders cannot be selected.");
                current = Path.GetDirectoryName(current);
            }
            if ((File.GetAttributes(root) & (FileAttributes.Hidden | FileAttributes.System | FileAttributes.Offline)) != 0) throw new ArgumentException("Choose a ready personal folder.");
            return root;
        }
        private ScanReport Scan(string root, CancellationToken token) {
            var start = DateTime.UtcNow;
            var result = new ScanReport { ScanId = Guid.NewGuid().ToString(), FolderName = Clean(Path.GetFileName(root), 80), StartedAt = start.ToString("o"), LargestFiles = new List<FileRecord>(), Types = new List<TypeRecord>() };
            var types = new Dictionary<string, TypeRecord>(StringComparer.OrdinalIgnoreCase);
            var pending = new Queue<Tuple<string,int>>(); pending.Enqueue(Tuple.Create(root, 0));
            int entries = 0;
            while (pending.Count > 0 && !result.LimitReached) {
                token.ThrowIfCancellationRequested();
                if (DateTime.UtcNow - start > TimeSpan.FromMinutes(10)) { result.LimitReached = true; break; }
                var directory = pending.Dequeue();
                try {
                    if (ProtectedPath(directory.Item1) || (File.GetAttributes(directory.Item1) & FileAttributes.ReparsePoint) != 0) { skipped++; continue; }
                    foreach (string entry in Directory.EnumerateFileSystemEntries(directory.Item1)) {
                        token.ThrowIfCancellationRequested();
                        if (++entries > 100000 || DateTime.UtcNow - start > TimeSpan.FromMinutes(10)) { result.LimitReached = true; break; }
                        try {
                            string full = Path.GetFullPath(entry);
                            if (!Within(full, root) || ProtectedPath(full)) { skipped++; continue; }
                            string name = Path.GetFileName(full);
                            var attributes = File.GetAttributes(full);
                            string extension = Path.GetExtension(name).ToLowerInvariant();
                            if ((attributes & (FileAttributes.ReparsePoint | FileAttributes.Offline | FileAttributes.Hidden | FileAttributes.System)) != 0 || ExcludedName(name)) { skipped++; continue; }
                            if ((attributes & FileAttributes.Directory) != 0) {
                                if (directory.Item2 >= 64) { result.LimitReached = true; skipped++; continue; }
                                pending.Enqueue(Tuple.Create(full, directory.Item2 + 1)); continue;
                            }
                            string relative = full.Substring(root.Length + 1).Replace('\\', '/');
                            if (relative.Length > 1024 || relative.Any(c => c < 32 || c == 127)) { skipped++; continue; }
                            var info = new FileInfo(full); long length = info.Length;
                            string modifiedAt = info.LastWriteTimeUtc.ToString("o");
                            if (length < 0 || length > SafeInteger - bytes) { result.LimitReached = true; skipped++; break; }
                            string type = String.IsNullOrEmpty(extension) ? "No extension" : System.Text.RegularExpressions.Regex.IsMatch(extension, @"^\.[a-z0-9][a-z0-9+_-]{0,19}$") ? extension : "Other";
                            if (!types.ContainsKey(type) && types.Count >= 19) type = "Other";
                            TypeRecord bucket;
                            if (!types.TryGetValue(type, out bucket)) { bucket = new TypeRecord { Type = type }; types[type] = bucket; }
                            bucket.Count++; bucket.Bytes += length; files++; bytes += length;
                            result.LargestFiles.Add(new FileRecord { RelativePath = relative, Type = type, Bytes = length, ModifiedAt = modifiedAt });
                            result.LargestFiles = result.LargestFiles.OrderByDescending(f => f.Bytes).ThenBy(f => f.RelativePath, StringComparer.Ordinal).Take(20).ToList();
                        } catch (OperationCanceledException) { throw; }
                        catch (IOException) { skipped++; }
                        catch (UnauthorizedAccessException) { skipped++; }
                        catch (System.Security.SecurityException) { skipped++; }
                    }
                } catch (OperationCanceledException) { throw; }
                catch (IOException) { skipped++; }
                catch (UnauthorizedAccessException) { skipped++; }
                catch (System.Security.SecurityException) { skipped++; }
            }
            token.ThrowIfCancellationRequested();
            result.FileCount = files; result.TotalBytes = bytes; result.SkippedCount = skipped;
            result.Types = types.Values.OrderByDescending(t => t.Bytes).ThenBy(t => t.Type).ToList();
            result.FinishedAt = DateTime.UtcNow.ToString("o"); return result;
        }
    }
}
