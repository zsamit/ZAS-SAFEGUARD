/**
 * ZAS Safeguard - macOS Blocker
 * 
 * DNS Proxy Network Extension
 * 
 * This Swift file provides a DNS proxy that intercepts DNS queries
 * and blocks domains on the blocklist.
 * 
 * Requirements:
 * - macOS 10.15+ (Catalina)
 * - Apple Developer Program membership
 * - Network Extension entitlement
 */

import Foundation
import NetworkExtension

class DNSProxyProvider: NEDNSProxyProvider {
    
    private var blockedDomains: Set<String> = []
    private var lastSync: Date = Date.distantPast
    
    // Default blocked domains (loaded from file on startup)
    private let defaultBlockedDomains: Set<String> = [
        "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com",
        "redtube.com", "youporn.com", "tube8.com", "spankbang.com",
        "porn.com", "brazzers.com", "bangbros.com"
    ]
    
    override func startProxy(options: [String : Any]? = nil, completionHandler: @escaping (Error?) -> Void) {
        NSLog("[ZAS] DNS Proxy starting...")
        
        // Load blocklist
        loadBlocklist()
        
        // Start periodic sync
        startPeriodicSync()
        
        completionHandler(nil)
        NSLog("[ZAS] DNS Proxy started with \(blockedDomains.count) blocked domains")
    }
    
    override func stopProxy(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        NSLog("[ZAS] DNS Proxy stopping with reason: \(reason)")
        completionHandler()
    }
    
    override func handleNewFlow(_ flow: NEAppProxyFlow) -> Bool {
        // Handle DNS flow
        guard let udpFlow = flow as? NEAppProxyUDPFlow else {
            return false
        }
        
        // Process UDP flow for DNS (port 53)
        handleUDPFlow(udpFlow)
        return true
    }
    
    // MARK: - DNS Flow Handling
    
    private func handleUDPFlow(_ flow: NEAppProxyUDPFlow) {
        flow.open(withLocalEndpoint: nil) { error in
            if let error = error {
                NSLog("[ZAS] Error opening UDP flow: \(error)")
                return
            }
            
            self.readDNSPackets(from: flow)
        }
    }
    
    private func readDNSPackets(from flow: NEAppProxyUDPFlow) {
        flow.readDatagrams { datagrams, endpoints, error in
            guard let datagrams = datagrams, let endpoints = endpoints else {
                if let error = error {
                    NSLog("[ZAS] Error reading datagrams: \(error)")
                }
                return
            }
            
            for (index, datagram) in datagrams.enumerated() {
                if let domain = self.extractDomainFromDNS(datagram) {
                    if self.shouldBlock(domain: domain) {
                        NSLog("[ZAS] Blocking DNS query for: \(domain)")
                        // Send NXDOMAIN response
                        self.sendBlockedResponse(for: datagram, to: flow, endpoint: endpoints[index])
                        self.logBlockEvent(domain: domain)
                    } else {
                        // Forward to real DNS
                        self.forwardDNSQuery(datagram, to: flow, endpoint: endpoints[index])
                    }
                }
            }
            
            // Continue reading
            self.readDNSPackets(from: flow)
        }
    }
    
    // MARK: - Domain Blocking
    
    private func shouldBlock(domain: String) -> Bool {
        let lowercaseDomain = domain.lowercased()
        
        // Check exact match
        if blockedDomains.contains(lowercaseDomain) {
            return true
        }
        
        // Check parent domains (e.g., sub.pornhub.com should be blocked)
        let components = lowercaseDomain.split(separator: ".")
        for i in 0..<components.count {
            let parentDomain = components[i...].joined(separator: ".")
            if blockedDomains.contains(parentDomain) {
                return true
            }
        }
        
        return false
    }
    
    private func extractDomainFromDNS(_ data: Data) -> String? {
        // Parse DNS packet to extract queried domain
        // DNS packet structure: Header (12 bytes) + Question section
        guard data.count > 12 else { return nil }
        
        var domain = ""
        var offset = 12 // Skip DNS header
        
        while offset < data.count {
            let labelLength = Int(data[offset])
            if labelLength == 0 {
                break
            }
            
            offset += 1
            if offset + labelLength > data.count {
                break
            }
            
            if !domain.isEmpty {
                domain += "."
            }
            
            let labelData = data[offset..<(offset + labelLength)]
            if let label = String(data: labelData, encoding: .utf8) {
                domain += label
            }
            
            offset += labelLength
        }
        
        return domain.isEmpty ? nil : domain
    }
    
    // MARK: - DNS Response Handling
    
    private func sendBlockedResponse(for query: Data, to flow: NEAppProxyUDPFlow, endpoint: NWEndpoint) {
        // Create NXDOMAIN response
        guard query.count >= 12 else { return }
        
        var response = query
        // Set response bit and NXDOMAIN (RCODE = 3)
        response[2] = 0x81 // QR=1, Opcode=0, AA=0, TC=0, RD=1
        response[3] = 0x83 // RA=1, Z=0, RCODE=3 (NXDOMAIN)
        
        flow.writeDatagrams([response], sentBy: [endpoint]) { error in
            if let error = error {
                NSLog("[ZAS] Error sending blocked response: \(error)")
            }
        }
    }
    
    private func forwardDNSQuery(_ query: Data, to flow: NEAppProxyUDPFlow, endpoint: NWEndpoint) {
        // In production, forward to configured DNS server
        // For now, we let it pass through
        flow.writeDatagrams([query], sentBy: [endpoint]) { error in
            if let error = error {
                NSLog("[ZAS] Error forwarding DNS query: \(error)")
            }
        }
    }
    
    // MARK: - Blocklist Management
    
    private func loadBlocklist() {
        // Load from UserDefaults (shared with main app)
        if let appGroup = UserDefaults(suiteName: "group.com.zas.safeguard") {
            if let savedDomains = appGroup.array(forKey: "blockedDomains") as? [String] {
                blockedDomains = Set(savedDomains)
            } else {
                blockedDomains = defaultBlockedDomains
            }
        } else {
            blockedDomains = defaultBlockedDomains
        }
    }
    
    private func saveBlocklist() {
        if let appGroup = UserDefaults(suiteName: "group.com.zas.safeguard") {
            appGroup.set(Array(blockedDomains), forKey: "blockedDomains")
        }
    }
    
    private func startPeriodicSync() {
        // Sync with Firebase every 15 minutes
        Timer.scheduledTimer(withTimeInterval: 900, repeats: true) { _ in
            self.syncWithFirebase()
        }
    }
    
    private func syncWithFirebase() {
        // Implement Firebase sync
        NSLog("[ZAS] Syncing blocklist with Firebase...")
        // TODO: Call Firebase function to get latest blocklist
    }
    
    private func logBlockEvent(domain: String) {
        // Log block event to Firebase
        NSLog("[ZAS] Block logged: \(domain)")
        // TODO: Send to Firebase
    }
}
