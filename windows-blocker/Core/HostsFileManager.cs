/**
 * ZAS Safeguard - Windows Hosts File Manager
 * 
 * Manages the Windows hosts file for domain blocking
 * and protects it from unauthorized modifications.
 */

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading.Tasks;

namespace ZASSafeguard.Service
{
    public class HostsFileManager
    {
        private readonly string _hostsPath;
        private readonly string _backupPath;
        private readonly string _markerStart = "# BEGIN ZAS SAFEGUARD";
        private readonly string _markerEnd = "# END ZAS SAFEGUARD";
        
        private HashSet<string> _blockedDomains;
        private FileSystemWatcher _watcher;
        private bool _isUpdating = false;
        
        public HostsFileManager(HashSet<string> blockedDomains)
        {
            _hostsPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"drivers\etc\hosts"
            );
            _backupPath = _hostsPath + ".zas.backup";
            _blockedDomains = blockedDomains;
        }
        
        public async Task InitializeAsync()
        {
            // Create backup
            CreateBackup();
            
            // Update hosts file
            await UpdateHostsFileAsync();
            
            // Lock the file
            LockHostsFile();
            
            // Start monitoring
            StartMonitoring();
            
            // Flush DNS cache
            FlushDnsCache();
        }
        
        public async Task UpdateBlockedDomainsAsync(HashSet<string> domains)
        {
            _blockedDomains = domains;
            await UpdateHostsFileAsync();
        }
        
        public async Task VerifyIntegrityAsync()
        {
            string content = await File.ReadAllTextAsync(_hostsPath);
            
            if (!content.Contains(_markerStart) || !content.Contains(_markerEnd))
            {
                Console.WriteLine("[ZAS] Hosts file integrity check failed - restoring...");
                await UpdateHostsFileAsync();
                LogTamperAttempt("integrity_check");
            }
        }
        
        private void CreateBackup()
        {
            if (!File.Exists(_backupPath))
            {
                File.Copy(_hostsPath, _backupPath);
                Console.WriteLine($"[ZAS] Backup created at {_backupPath}");
            }
        }
        
        private async Task UpdateHostsFileAsync()
        {
            _isUpdating = true;
            
            try
            {
                // Unlock temporarily
                UnlockHostsFile();
                
                // Read current content
                string content = await File.ReadAllTextAsync(_hostsPath);
                
                // Remove existing ZAS block
                int startIndex = content.IndexOf(_markerStart);
                int endIndex = content.IndexOf(_markerEnd);
                
                if (startIndex >= 0 && endIndex >= 0)
                {
                    endIndex += _markerEnd.Length;
                    content = content.Remove(startIndex, endIndex - startIndex);
                }
                
                // Build new ZAS block
                var lines = new List<string>
                {
                    "",
                    _markerStart,
                    "# Managed by ZAS Safeguard - DO NOT MODIFY",
                    $"# Last updated: {DateTime.Now:yyyy-MM-dd HH:mm:ss}",
                    ""
                };
                
                foreach (var domain in _blockedDomains)
                {
                    lines.Add($"0.0.0.0 {domain}");
                    lines.Add($"0.0.0.0 www.{domain}");
                    lines.Add($"::0 {domain}");
                    lines.Add($"::0 www.{domain}");
                }
                
                lines.Add("");
                lines.Add(_markerEnd);
                lines.Add("");
                
                // Append block
                content += string.Join(Environment.NewLine, lines);
                
                // Write file
                await File.WriteAllTextAsync(_hostsPath, content);
                
                // Re-lock
                LockHostsFile();
                
                // Flush DNS
                FlushDnsCache();
                
                Console.WriteLine($"[ZAS] Hosts file updated with {_blockedDomains.Count} domains");
            }
            finally
            {
                _isUpdating = false;
            }
        }
        
        private void LockHostsFile()
        {
            try
            {
                var fileInfo = new FileInfo(_hostsPath);
                var security = fileInfo.GetAccessControl();
                
                // Get current user
                var currentUser = WindowsIdentity.GetCurrent();
                var usersSid = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
                
                // Deny write access to Users group
                security.AddAccessRule(new FileSystemAccessRule(
                    usersSid,
                    FileSystemRights.Write | FileSystemRights.Delete,
                    AccessControlType.Deny
                ));
                
                fileInfo.SetAccessControl(security);
                fileInfo.IsReadOnly = true;
                
                Console.WriteLine("[ZAS] Hosts file locked");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ZAS] Error locking hosts file: {ex.Message}");
            }
        }
        
        private void UnlockHostsFile()
        {
            try
            {
                var fileInfo = new FileInfo(_hostsPath);
                fileInfo.IsReadOnly = false;
                
                var security = fileInfo.GetAccessControl();
                var usersSid = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
                
                // Remove deny rule
                security.RemoveAccessRule(new FileSystemAccessRule(
                    usersSid,
                    FileSystemRights.Write | FileSystemRights.Delete,
                    AccessControlType.Deny
                ));
                
                fileInfo.SetAccessControl(security);
                
                Console.WriteLine("[ZAS] Hosts file unlocked");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ZAS] Error unlocking hosts file: {ex.Message}");
            }
        }
        
        private void StartMonitoring()
        {
            var directory = Path.GetDirectoryName(_hostsPath);
            var filename = Path.GetFileName(_hostsPath);
            
            _watcher = new FileSystemWatcher(directory, filename)
            {
                NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size
            };
            
            _watcher.Changed += OnHostsFileChanged;
            _watcher.EnableRaisingEvents = true;
            
            Console.WriteLine("[ZAS] Hosts file monitoring started");
        }
        
        private async void OnHostsFileChanged(object sender, FileSystemEventArgs e)
        {
            if (_isUpdating) return;
            
            Console.WriteLine("[ZAS] Unauthorized hosts file modification detected!");
            LogTamperAttempt("file_modified");
            
            // Restore our entries
            await Task.Delay(100); // Small delay to ensure file is released
            await UpdateHostsFileAsync();
        }
        
        private void FlushDnsCache()
        {
            try
            {
                var process = new System.Diagnostics.Process
                {
                    StartInfo = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "ipconfig",
                        Arguments = "/flushdns",
                        CreateNoWindow = true,
                        UseShellExecute = false
                    }
                };
                
                process.Start();
                process.WaitForExit();
                
                Console.WriteLine("[ZAS] DNS cache flushed");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ZAS] Error flushing DNS cache: {ex.Message}");
            }
        }
        
        private void LogTamperAttempt(string type)
        {
            Console.WriteLine($"[ZAS] Tamper attempt logged: {type}");
            // TODO: Send to Firebase
        }
    }
}
