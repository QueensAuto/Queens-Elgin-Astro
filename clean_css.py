import os
path = r'c:\Users\QUEENS\Desktop\Queens Auto - Astro\Queens-Elgin-Astro\src\styles\global.css'
try:
    with open(path, 'rb') as f:
        content = f.read()
    # Remove null bytes
    content = content.replace(b'\x00', b'')
    # Remove the garbage at the end
    # It might start with }* or just *
    if b'}*' in content:
        content = content.split(b'}*')[0] + b'}\n'
    elif b'* { outline' in content:
         content = content.split(b'* { outline')[0]
    
    with open(path, 'wb') as f:
        f.write(content)
    print("Successfully cleaned global.css")
except Exception as e:
    print(f"Error: {e}")
