from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import json
import os
from datetime import datetime

# Storage for potion history
POTION_HISTORY_FILE = 'potion_history.json'
CONTRIBUTION_HISTORY_FILE = 'contribution_history.json'

def load_potion_history():
    """Load potion history from JSON file"""
    if os.path.exists(POTION_HISTORY_FILE):
        with open(POTION_HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_potion_history(history):
    """Save potion history to JSON file"""
    with open(POTION_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(history, f, indent=2)

def get_potion_history(current_data):
    """Get full potion history for all members"""
    history = load_potion_history()
    
    if not history or not current_data.get('Members'):
        return {}
    
    history_data = {}
    previous_members = history.get('members', {})
    current_members = current_data.get('Members', {})
    
    for member_id, member in current_members.items():
        member_history = {}
        previous_potions = previous_members.get(str(member_id), {}).get('Potions', {})
        current_potions = member.get('Potions', {})
        
        # Get all potion types that exist in current or previous
        all_potion_ids = set(list(previous_potions.keys()) + list(current_potions.keys()))
        
        for potion_id in all_potion_ids:
            potion_id_str = str(potion_id)
            prev_amt = previous_potions.get(potion_id, 0)
            curr_amt = current_potions.get(potion_id, 0)
            
            # If this potion has history entries, retrieve them
            if previous_potions and str(member_id) in previous_members:
                existing_history = previous_members[str(member_id)].get('PotionHistory', {}).get(potion_id_str, [])
                member_history[potion_id_str] = list(existing_history)  # Copy the history
            else:
                member_history[potion_id_str] = []
        
        if member_history:
            history_data[member_id] = member_history
    
    return history_data

def update_potion_history(current_data):
    """Update potion history with current data, adding new entries when values change"""
    history = load_potion_history()
    now = datetime.now()
    
    if not current_data.get('Members'):
        return
    
    # Initialize history if needed
    if not history:
        history = {'last_update': now.isoformat(), 'members': {}}
    
    previous_members = history.get('members', {})
    current_members = current_data.get('Members', {})
    
    # Update or initialize member history
    for member_id, member in current_members.items():
        member_id_str = str(member_id)
        is_new_member = member_id_str not in history['members']
        
        if is_new_member:
            history['members'][member_id_str] = {
                'Name': member.get('Name', 'Unknown'),
                'Potions': {},
                'PotionHistory': {}
            }
        
        previous_member = history['members'][member_id_str]
        previous_potions = previous_member.get('Potions', {})
        current_potions = member.get('Potions', {})
        
        # Initialize PotionHistory if needed
        if 'PotionHistory' not in previous_member:
            previous_member['PotionHistory'] = {}
        
        # Check for changes and add history entries
        all_potion_ids = set(list(previous_potions.keys()) + list(current_potions.keys()))
        
        for potion_id in all_potion_ids:
            potion_id_str = str(potion_id)
            prev_amt = previous_potions.get(potion_id, 0)
            curr_amt = current_potions.get(potion_id, 0)
            
            # Initialize history list for this potion if needed
            if potion_id_str not in previous_member['PotionHistory']:
                previous_member['PotionHistory'][potion_id_str] = []
            
            # If the value changed (and member already existed), add a new history entry
            # Record the OLD value, not the new one (new value is already in current Potions)
            if not is_new_member and prev_amt != curr_amt:
                previous_member['PotionHistory'][potion_id_str].append({
                    'amount': prev_amt,
                    'timestamp': now.isoformat()
                })
        
        # Update current potion values
        previous_member['Potions'] = current_potions
    
    history['last_update'] = now.isoformat()
    save_potion_history(history)

def load_contribution_history():
    """Load contribution history from JSON file"""
    if os.path.exists(CONTRIBUTION_HISTORY_FILE):
        with open(CONTRIBUTION_HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_contribution_history(history):
    """Save contribution history to JSON file"""
    with open(CONTRIBUTION_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(history, f, indent=2)

def get_contribution_history(current_data):
    """Get contribution history for all members and guild funds (returns previous snapshot)"""
    history = load_contribution_history()
    
    if not history:
        return {}
    
    history_data = {}
    previous_members = history.get('members', {})
    current_members = current_data.get('Members', {})
    
    # Return previous guild funds if available
    if 'guild_funds' in history:
        history_data['guild_funds'] = history['guild_funds']
        history_data['guild_funds_timestamp'] = history.get('guild_funds_timestamp', history.get('last_update'))
    
    for member_id, member in current_members.items():
        member_id_str = str(member_id)
        if member_id_str in previous_members:
            # Return previous contributions snapshot with timestamp
            prev_member = previous_members[member_id_str]
            history_data[member_id] = {
                'Contributions': prev_member.get('Contributions', {}),
                'last_update': prev_member.get('last_update')
            }
    
    return history_data

def update_contribution_history(current_data):
    """Update contribution history with current snapshot including guild funds"""
    history = load_contribution_history()
    now = datetime.now()
    
    if not current_data.get('Members'):
        return
    
    # Initialize history if needed
    if not history:
        history = {'last_update': now.isoformat(), 'members': {}, 'guild_funds': {}}
    
    # Update guild funds snapshot only if values changed
    if 'Funds' in current_data:
        funds_changed = False
        if 'guild_funds' not in history:
            funds_changed = True
        else:
            # Check if any fund value changed
            for resource_id, current_value in current_data['Funds'].items():
                previous_value = history['guild_funds'].get(resource_id, 0)
                if abs(current_value - previous_value) > 0.01:  # Small threshold for floating point comparison
                    funds_changed = True
                    break
        
        if funds_changed:
            history['guild_funds'] = current_data['Funds'].copy()
            history['guild_funds_timestamp'] = now.isoformat()
        # Keep the old timestamp if values didn't change
    
    previous_members = history.get('members', {})
    current_members = current_data.get('Members', {})
    
    # Update or initialize member history
    for member_id, member in current_members.items():
        member_id_str = str(member_id)
        is_new_member = member_id_str not in history['members']
        
        if is_new_member:
            history['members'][member_id_str] = {
                'Name': member.get('Name', 'Unknown'),
                'Contributions': {},
                'last_update': now.isoformat()
            }
        
        previous_member = history['members'][member_id_str]
        current_contributions = member.get('Contributions', {}).copy()
        previous_contributions = previous_member.get('Contributions', {})
        
        # Check if contributions changed
        contributions_changed = False
        if len(current_contributions) != len(previous_contributions):
            contributions_changed = True
        else:
            for resource_id, current_value in current_contributions.items():
                previous_value = previous_contributions.get(resource_id, 0)
                if abs(current_value - previous_value) > 0.01:  # Small threshold for floating point comparison
                    contributions_changed = True
                    break
            # Also check for removed resources
            if not contributions_changed:
                for resource_id in previous_contributions:
                    if resource_id not in current_contributions:
                        contributions_changed = True
                        break
        
        # Update current contributions snapshot
        previous_member['Contributions'] = current_contributions
        
        # Only update timestamp if contributions actually changed
        if contributions_changed:
            previous_member['last_update'] = now.isoformat()
        # Otherwise keep the old timestamp so time calculation uses correct reference point
    
    history['last_update'] = now.isoformat()
    save_contribution_history(history)

class GuildHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            
            with open('index.html', 'r', encoding='utf-8') as f:
                self.wfile.write(f.read().encode('utf-8'))
        
        elif self.path == '/contributions.html':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            
            with open('contributions.html', 'r', encoding='utf-8') as f:
                self.wfile.write(f.read().encode('utf-8'))
        
        elif self.path.startswith('/api/guild/'):
            # Proxy request to Manarion API
            guild_id = self.path.split('/')[-1].split('?')[0]
            api_key = self.path.split('apikey=')[-1] if 'apikey=' in self.path else ''
            
            url = f'https://api.manarion.com/guilds/{guild_id}?apikey={api_key}'
            
            req = urllib.request.Request(url)
            response = urllib.request.urlopen(req)
            data_bytes = response.read()
            
            # Parse the JSON to add potion history
            data = json.loads(data_bytes.decode('utf-8'))
            
            # Get potion history (before updating)
            potion_history = get_potion_history(data)
            
            # Get contribution history (before updating)
            contribution_history = get_contribution_history(data)
            
            # Add history to response
            data['potion_history'] = potion_history
            data['contribution_history'] = contribution_history
            
            # Update history after getting it
            update_potion_history(data)
            update_contribution_history(data)
            
            # Send modified data
            response_data = json.dumps(data).encode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response_data)
        
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    server = HTTPServer(('localhost', 8000), GuildHandler)
    print('Server running at http://localhost:8000')
    server.serve_forever()

