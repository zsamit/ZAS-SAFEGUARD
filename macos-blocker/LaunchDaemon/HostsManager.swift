/**
 * ZAS Safeguard - macOS Hosts File Manager
 * 
 * LaunchDaemon that manages the hosts file to block domains
 * and prevents unauthorized modifications.
 * 
 * Install: Copy to /Library/LaunchDaemons/com.zas.safeguard.hostsd.plist
 */

import Foundation

class HostsManager {
    
    private let hostsPath = "/etc/hosts"
    private let backupPath = "/etc/hosts.zas.backup"
    private let markerStart = "# BEGIN ZAS SAFEGUARD"
    private let markerEnd = "# END ZAS SAFEGUARD"
    
    private var blockedDomains: [String] = []
    private var isLocked = false
    
    // MARK: - Public Methods
    
    /// Initialize and lock the hosts file
    func initialize() {
        NSLog("[ZAS Hosts] Initializing hosts file manager...")
        
        // Create backup of original hosts file
        createBackup()
        
        // Load blocklist
        loadBlocklist()
        
        // Update hosts file
        updateHostsFile()
        
        // Lock the file
        lockHostsFile()
        
        // Start monitoring for changes
        startMonitoring()
        
        NSLog("[ZAS Hosts] Initialized with \(blockedDomains.count) blocked domains")
    }
    
    /// Update blocked domains and refresh hosts file
    func updateBlockedDomains(_ domains: [String]) {
        blockedDomains = domains
        updateHostsFile()
        saveBlocklist()
    }
    
    /// Temporarily unlock (requires cloud authorization)
    func unlock(authToken: String, completion: @escaping (Bool) -> Void) {
        // Verify token with Firebase
        verifyUnlockToken(authToken) { authorized in
            if authorized {
                self.unlockHostsFile()
                
                // Re-lock after timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + 3600) {
                    self.lockHostsFile()
                }
                
                completion(true)
            } else {
                completion(false)
            }
        }
    }
    
    // MARK: - Hosts File Operations
    
    private func createBackup() {
        let fileManager = FileManager.default
        
        if !fileManager.fileExists(atPath: backupPath) {
            do {
                try fileManager.copyItem(atPath: hostsPath, toPath: backupPath)
                NSLog("[ZAS Hosts] Backup created at \(backupPath)")
            } catch {
                NSLog("[ZAS Hosts] Error creating backup: \(error)")
            }
        }
    }
    
    private func updateHostsFile() {
        do {
            // Read current hosts file
            var content = try String(contentsOfFile: hostsPath, encoding: .utf8)
            
            // Remove existing ZAS block
            if let startRange = content.range(of: markerStart),
               let endRange = content.range(of: markerEnd) {
                content.removeSubrange(startRange.lowerBound...endRange.upperBound)
            }
            
            // Build ZAS block
            var zasBlock = "\n\(markerStart)\n"
            zasBlock += "# Managed by ZAS Safeguard - DO NOT MODIFY\n"
            zasBlock += "# Last updated: \(Date())\n\n"
            
            for domain in blockedDomains {
                zasBlock += "0.0.0.0 \(domain)\n"
                zasBlock += "0.0.0.0 www.\(domain)\n"
            }
            
            zasBlock += "\n\(markerEnd)\n"
            
            // Append ZAS block
            content += zasBlock
            
            // Unlock temporarily to write
            unlockHostsFile()
            
            // Write updated hosts file
            try content.write(toFile: hostsPath, atomically: true, encoding: .utf8)
            
            // Re-lock
            lockHostsFile()
            
            // Flush DNS cache
            flushDNSCache()
            
            NSLog("[ZAS Hosts] Hosts file updated with \(blockedDomains.count) domains")
            
        } catch {
            NSLog("[ZAS Hosts] Error updating hosts file: \(error)")
        }
    }
    
    private func lockHostsFile() {
        let task = Process()
        task.launchPath = "/usr/bin/chflags"
        task.arguments = ["uchg", hostsPath]
        
        do {
            try task.run()
            task.waitUntilExit()
            isLocked = true
            NSLog("[ZAS Hosts] Hosts file locked")
        } catch {
            NSLog("[ZAS Hosts] Error locking hosts file: \(error)")
        }
    }
    
    private func unlockHostsFile() {
        let task = Process()
        task.launchPath = "/usr/bin/chflags"
        task.arguments = ["nouchg", hostsPath]
        
        do {
            try task.run()
            task.waitUntilExit()
            isLocked = false
            NSLog("[ZAS Hosts] Hosts file unlocked")
        } catch {
            NSLog("[ZAS Hosts] Error unlocking hosts file: \(error)")
        }
    }
    
    private func flushDNSCache() {
        let task = Process()
        task.launchPath = "/usr/bin/dscacheutil"
        task.arguments = ["-flushcache"]
        
        do {
            try task.run()
            task.waitUntilExit()
            
            // Also kill DNS responder
            let killTask = Process()
            killTask.launchPath = "/usr/bin/killall"
            killTask.arguments = ["-HUP", "mDNSResponder"]
            try killTask.run()
            killTask.waitUntilExit()
            
            NSLog("[ZAS Hosts] DNS cache flushed")
        } catch {
            NSLog("[ZAS Hosts] Error flushing DNS cache: \(error)")
        }
    }
    
    // MARK: - File Monitoring
    
    private func startMonitoring() {
        let fileDescriptor = open(hostsPath, O_EVTONLY)
        guard fileDescriptor >= 0 else {
            NSLog("[ZAS Hosts] Error opening hosts file for monitoring")
            return
        }
        
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .delete, .rename, .attrib],
            queue: DispatchQueue.global()
        )
        
        source.setEventHandler { [weak self] in
            NSLog("[ZAS Hosts] Hosts file modification detected!")
            
            // Restore our entries
            self?.updateHostsFile()
            
            // Log tamper attempt
            self?.logTamperAttempt()
        }
        
        source.setCancelHandler {
            close(fileDescriptor)
        }
        
        source.resume()
        
        NSLog("[ZAS Hosts] File monitoring started")
    }
    
    private func logTamperAttempt() {
        NSLog("[ZAS Hosts] Tamper attempt detected and blocked")
        // TODO: Send to Firebase
    }
    
    // MARK: - Blocklist Management
    
    private func loadBlocklist() {
        if let appGroup = UserDefaults(suiteName: "group.com.zas.safeguard") {
            if let domains = appGroup.array(forKey: "blockedDomains") as? [String] {
                blockedDomains = domains
            }
        }
        
        // Always include default domains
        let defaults = [
            "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com",
            "redtube.com", "youporn.com", "tube8.com", "spankbang.com",
            "porn.com", "brazzers.com", "bangbros.com"
        ]
        
        for domain in defaults {
            if !blockedDomains.contains(domain) {
                blockedDomains.append(domain)
            }
        }
    }
    
    private func saveBlocklist() {
        if let appGroup = UserDefaults(suiteName: "group.com.zas.safeguard") {
            appGroup.set(blockedDomains, forKey: "blockedDomains")
        }
    }
    
    private func verifyUnlockToken(_ token: String, completion: @escaping (Bool) -> Void) {
        // TODO: Verify with Firebase
        completion(false) // Default deny
    }
}

// MARK: - LaunchDaemon Entry Point

let manager = HostsManager()
manager.initialize()

// Keep the daemon running
RunLoop.main.run()
