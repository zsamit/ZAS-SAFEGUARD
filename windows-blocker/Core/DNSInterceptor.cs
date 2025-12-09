/**
 * ZAS Safeguard - Windows DNS Interceptor
 * 
 * Intercepts DNS queries at the system level to block
 * domains before they can be resolved.
 * 
 * Uses WinDivert or similar for packet interception.
 */

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

namespace ZASSafeguard.Service
{
    public class DNSInterceptor
    {
        private HashSet<string> _blockedDomains;
        private UdpClient _listener;
        private bool _isRunning = false;
        
        // DNS Server config
        private const int DNS_PORT = 53;
        private readonly IPAddress _listenAddress = IPAddress.Loopback;
        private readonly IPEndPoint _upstreamDns = new IPEndPoint(IPAddress.Parse("8.8.8.8"), DNS_PORT);
        
        public DNSInterceptor(HashSet<string> blockedDomains)
        {
            _blockedDomains = blockedDomains;
        }
        
        public async Task StartAsync(CancellationToken cancellationToken)
        {
            Console.WriteLine("[ZAS DNS] Starting DNS interceptor...");
            
            // Configure system to use our local DNS
            ConfigureSystemDns();
            
            // Start local DNS proxy
            _listener = new UdpClient(new IPEndPoint(_listenAddress, DNS_PORT));
            _isRunning = true;
            
            Console.WriteLine($"[ZAS DNS] Listening on {_listenAddress}:{DNS_PORT}");
            
            // Process DNS queries
            while (_isRunning && !cancellationToken.IsCancellationRequested)
            {
                try
                {
                    var result = await _listener.ReceiveAsync();
                    _ = ProcessDnsQueryAsync(result.Buffer, result.RemoteEndPoint);
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[ZAS DNS] Error: {ex.Message}");
                }
            }
        }
        
        public void Stop()
        {
            _isRunning = false;
            _listener?.Close();
            
            // Restore original DNS settings
            RestoreSystemDns();
            
            Console.WriteLine("[ZAS DNS] DNS interceptor stopped");
        }
        
        public void UpdateBlockedDomains(HashSet<string> domains)
        {
            _blockedDomains = domains;
            Console.WriteLine($"[ZAS DNS] Updated blocklist: {domains.Count} domains");
        }
        
        private async Task ProcessDnsQueryAsync(byte[] query, IPEndPoint clientEndpoint)
        {
            try
            {
                // Parse DNS query
                var domain = ExtractDomainFromQuery(query);
                
                if (string.IsNullOrEmpty(domain))
                {
                    await ForwardQueryAsync(query, clientEndpoint);
                    return;
                }
                
                // Check if domain should be blocked
                if (ShouldBlock(domain))
                {
                    Console.WriteLine($"[ZAS DNS] Blocking: {domain}");
                    await SendBlockedResponseAsync(query, clientEndpoint);
                    LogBlockEvent(domain);
                }
                else
                {
                    await ForwardQueryAsync(query, clientEndpoint);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ZAS DNS] Query processing error: {ex.Message}");
            }
        }
        
        private bool ShouldBlock(string domain)
        {
            var lowerDomain = domain.ToLowerInvariant();
            
            // Check exact match
            if (_blockedDomains.Contains(lowerDomain))
                return true;
            
            // Check parent domains (sub.pornhub.com -> pornhub.com)
            var parts = lowerDomain.Split('.');
            for (int i = 0; i < parts.Length - 1; i++)
            {
                var parentDomain = string.Join(".", parts, i, parts.Length - i);
                if (_blockedDomains.Contains(parentDomain))
                    return true;
            }
            
            return false;
        }
        
        private string ExtractDomainFromQuery(byte[] data)
        {
            if (data.Length < 12) return null;
            
            try
            {
                // Skip DNS header (12 bytes)
                int offset = 12;
                var labels = new List<string>();
                
                while (offset < data.Length)
                {
                    int labelLength = data[offset];
                    if (labelLength == 0) break;
                    
                    offset++;
                    if (offset + labelLength > data.Length) break;
                    
                    var label = System.Text.Encoding.ASCII.GetString(data, offset, labelLength);
                    labels.Add(label);
                    
                    offset += labelLength;
                }
                
                return labels.Count > 0 ? string.Join(".", labels) : null;
            }
            catch
            {
                return null;
            }
        }
        
        private async Task SendBlockedResponseAsync(byte[] query, IPEndPoint clientEndpoint)
        {
            // Create NXDOMAIN response
            var response = new byte[query.Length];
            Array.Copy(query, response, query.Length);
            
            // Set response flags (QR=1, RCODE=3 NXDOMAIN)
            response[2] = (byte)(query[2] | 0x80); // QR = 1
            response[3] = (byte)((query[3] & 0xF0) | 0x03); // RCODE = 3
            
            await _listener.SendAsync(response, response.Length, clientEndpoint);
        }
        
        private async Task ForwardQueryAsync(byte[] query, IPEndPoint clientEndpoint)
        {
            using var forwarder = new UdpClient();
            
            // Send to upstream DNS
            await forwarder.SendAsync(query, query.Length, _upstreamDns);
            
            // Wait for response (with timeout)
            var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try
            {
                var result = await forwarder.ReceiveAsync();
                await _listener.SendAsync(result.Buffer, result.Buffer.Length, clientEndpoint);
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine("[ZAS DNS] Upstream DNS timeout");
            }
        }
        
        private void ConfigureSystemDns()
        {
            // Set system DNS to 127.0.0.1 to route through our interceptor
            // This requires admin privileges
            try
            {
                var processInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "netsh",
                    Arguments = "interface ip set dns \"Ethernet\" static 127.0.0.1",
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                
                var process = System.Diagnostics.Process.Start(processInfo);
                process?.WaitForExit();
                
                Console.WriteLine("[ZAS DNS] System DNS configured to use interceptor");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ZAS DNS] Error configuring DNS: {ex.Message}");
            }
        }
        
        private void RestoreSystemDns()
        {
            try
            {
                var processInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "netsh",
                    Arguments = "interface ip set dns \"Ethernet\" dhcp",
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                
                var process = System.Diagnostics.Process.Start(processInfo);
                process?.WaitForExit();
                
                Console.WriteLine("[ZAS DNS] System DNS restored to DHCP");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ZAS DNS] Error restoring DNS: {ex.Message}");
            }
        }
        
        private void LogBlockEvent(string domain)
        {
            Console.WriteLine($"[ZAS DNS] Block logged: {domain}");
            // TODO: Send to Firebase
        }
    }
}
