/**
 * ZAS Safeguard - Windows Service
 * 
 * Main Windows Service that manages blocking at the OS level.
 * 
 * Features:
 * - Runs as Windows Service (starts at boot)
 * - DNS query interception
 * - Hosts file management and protection
 * - Firebase sync
 * - Tamper prevention
 */

using System;
using System.Collections.Generic;
using System.ServiceProcess;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace ZASSafeguard.Service
{
    public class ZASSafeguardService : ServiceBase
    {
        private readonly ILogger<ZASSafeguardService> _logger;
        private readonly HostsFileManager _hostsManager;
        private readonly DNSInterceptor _dnsInterceptor;
        private readonly ProcessGuard _processGuard;
        private readonly FirebaseSync _firebaseSync;
        
        private CancellationTokenSource _cancellationTokenSource;
        private Task _mainTask;
        
        private HashSet<string> _blockedDomains;
        
        // Default porn domains (always blocked)
        private readonly string[] DefaultBlockedDomains = new[]
        {
            "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com",
            "redtube.com", "youporn.com", "tube8.com", "spankbang.com",
            "porn.com", "brazzers.com", "bangbros.com", "realitykings.com"
        };
        
        public ZASSafeguardService()
        {
            ServiceName = "ZASSafeguard";
            CanStop = false; // Prevent stopping (can be overridden with cloud auth)
            CanPauseAndContinue = false;
            CanShutdown = true;
            AutoLog = true;
            
            _blockedDomains = new HashSet<string>(DefaultBlockedDomains, StringComparer.OrdinalIgnoreCase);
            
            // Initialize components
            _hostsManager = new HostsFileManager(_blockedDomains);
            _dnsInterceptor = new DNSInterceptor(_blockedDomains);
            _processGuard = new ProcessGuard();
            _firebaseSync = new FirebaseSync();
        }
        
        protected override void OnStart(string[] args)
        {
            _logger?.LogInformation("ZAS Safeguard Service starting...");
            
            _cancellationTokenSource = new CancellationTokenSource();
            
            // Start main service task
            _mainTask = Task.Run(() => RunServiceAsync(_cancellationTokenSource.Token));
            
            _logger?.LogInformation("ZAS Safeguard Service started");
        }
        
        private async Task RunServiceAsync(CancellationToken cancellationToken)
        {
            try
            {
                // Initialize hosts file blocking
                await _hostsManager.InitializeAsync();
                
                // Start DNS interception
                await _dnsInterceptor.StartAsync(cancellationToken);
                
                // Start process guard (prevents task manager kill)
                _processGuard.Start();
                
                // Initial Firebase sync
                await SyncWithFirebaseAsync();
                
                // Main loop
                while (!cancellationToken.IsCancellationRequested)
                {
                    // Periodic sync every 15 minutes
                    await Task.Delay(TimeSpan.FromMinutes(15), cancellationToken);
                    await SyncWithFirebaseAsync();
                    
                    // Verify hosts file integrity
                    await _hostsManager.VerifyIntegrityAsync();
                }
            }
            catch (OperationCanceledException)
            {
                // Expected on shutdown
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error in main service loop");
            }
        }
        
        private async Task SyncWithFirebaseAsync()
        {
            try
            {
                var domains = await _firebaseSync.GetBlockedDomainsAsync();
                
                if (domains != null && domains.Count > 0)
                {
                    // Merge with defaults
                    foreach (var domain in DefaultBlockedDomains)
                    {
                        domains.Add(domain);
                    }
                    
                    _blockedDomains = domains;
                    
                    // Update components
                    await _hostsManager.UpdateBlockedDomainsAsync(domains);
                    _dnsInterceptor.UpdateBlockedDomains(domains);
                    
                    _logger?.LogInformation($"Synced {domains.Count} blocked domains");
                }
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Firebase sync failed, using local blocklist");
            }
        }
        
        protected override void OnStop()
        {
            // Normally prevent stopping, but allow for authorized shutdown
            _logger?.LogWarning("Stop requested - checking authorization...");
            
            // In production, check cloud authorization before allowing stop
            // For now, we'll allow it but log the event
            
            _cancellationTokenSource?.Cancel();
            _mainTask?.Wait(TimeSpan.FromSeconds(10));
            
            _dnsInterceptor?.Stop();
            _processGuard?.Stop();
            
            _logger?.LogInformation("ZAS Safeguard Service stopped");
        }
        
        protected override void OnShutdown()
        {
            // System shutdown - allow graceful stop
            _cancellationTokenSource?.Cancel();
            _mainTask?.Wait(TimeSpan.FromSeconds(5));
            
            _logger?.LogInformation("ZAS Safeguard Service shutdown complete");
        }
        
        public static void Main(string[] args)
        {
            if (Environment.UserInteractive)
            {
                // Running in console mode for debugging
                Console.WriteLine("ZAS Safeguard Service - Console Mode");
                Console.WriteLine("Press Ctrl+C to exit");
                
                var service = new ZASSafeguardService();
                service.OnStart(args);
                
                Console.CancelKeyPress += (s, e) =>
                {
                    e.Cancel = true;
                    service.OnStop();
                };
                
                Thread.Sleep(Timeout.Infinite);
            }
            else
            {
                // Running as Windows Service
                ServiceBase.Run(new ZASSafeguardService());
            }
        }
    }
}
